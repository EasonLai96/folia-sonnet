package top.izuna.foliamajor.export;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.view.PixelCopy;
import android.view.Surface;
import android.view.Window;

import java.io.FileDescriptor;
import java.nio.ByteBuffer;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 一整次「把歌词动画录成视频」的会话。
 *
 * 为什么必须自己写这一层：导出能力原来只存在于 Electron 那一侧
 * （`electron/modSystem/exportService.cjs` + ffmpeg），安卓上 `src/mods/ipc.ts`
 * 拿不到 bridge、`reloadMods()` 直接返回空数组 —— 于是「渲染导出」这个模组在手机上
 * 连列表里都看不见。这段就是那条能力在安卓上的替身，并且不经过模组：
 * 它听控制面板那一页的话，不依赖任何模组加载。
 *
 * 三段拼起来：
 *
 *  1. **抓帧**：`PixelCopy` 抓主窗口当前这一帧（API 26+）。
 *     不能用离屏 WebView —— 不可见的 View 不会被合成，PixelCopy 只能抓到空白，
 *     而 `View.draw()` 对 WebView 也画不出 Surface 上的内容。所以导出期间画面必须
 *     真的在屏幕上，这也是「导出中请留在应用里」这条要求的由来。
 *  2. **编码**：H.264 走 `createInputSurface()`，把帧用 Canvas 画上去，
 *     YUV 转换由 MediaCodec 自己做 —— 手写一遍既慢又容易在部分机型上出绿边。
 *  3. **合成**：`MediaMuxer` 出 MP4。
 *
 * 帧不是按墙钟走的，而是**每帧一次握手**：请求 Web 侧把可视化推到第 N 帧的时间，
 * 等它回报「画好了」再抓。这样录出来的是确定性的画面，而不是「刚好赶上什么算什么」
 * —— 也顺带让慢机器不会录出一堆重复帧。
 *
 * 透明：**不做**。MediaCodec 的 VP8/VP9/AV1 在安卓上都不支持 alpha 通道，
 * HEVC alpha / ProRes 也没有；要保住透明只能打包第三方编码器。所以这里是带背景的
 * MP4，背景色由调用方给。
 */
public final class VideoExportSession {

    private static final String TAG = "FoliaVideoExport";
    private static final String MIME = MediaFormat.MIMETYPE_VIDEO_AVC;

    /** 等 Web 侧「这一帧画好了」的时限。超时就当这一帧丢了，不能把整条导出卡死。 */
    private static final long FRAME_READY_TIMEOUT_MS = 4000;
    /** 等 PixelCopy 的时限。趁它慢的机型上不至于无限等。 */
    private static final long CAPTURE_TIMEOUT_MS = 1500;
    private static final long CODEC_TIMEOUT_US = 10_000L;

    /** 一次导出的参数。全部由 Web 侧给。 */
    public static final class Spec {
        public final int width;
        public final int height;
        public final int fps;
        public final int bitrateMbps;
        public final int totalFrames;
        public final double startSec;
        /** 背景色（不透明）。画面里的透明像素会先被铺上它。 */
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
        /** 让 Web 侧把画面推到第 `index` 帧（时间 `timeSec`）。跑在主线程。 */
        void onFrameRequested(int index, double timeSec);

        /** 进度。跑在主线程。 */
        void onProgress(int frame, int total);

        /** 正常收尾。`path` 是给人看的位置描述。跑在主线程。 */
        void onCompleted(String path);

        /** 失败。`message` 是可以直接给用户看的一句话。跑在主线程。 */
        void onFailed(String message);

        void onCancelled();
    }

    private final Window window;
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
    private Bitmap captureBitmap;
    private Rect captureRect;
    private int videoTrackIndex = -1;
    private boolean muxerStarted = false;

    private volatile boolean running = false;
    private volatile boolean cancelled = false;
    private volatile int frameIndex = 0;
    /** Web 侧回报「画好了」的门闩；每帧换一个新的。 */
    private volatile CountDownLatch frameReadyLatch;

    private final Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);

    public VideoExportSession(Window window, FileDescriptor output, String outputLabel,
                              Spec spec, Listener listener) {
        this.window = window;
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
            fail("安卓 8.0（API 26）以下抓不到屏幕内容，无法导出。");
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
        CountDownLatch latch = frameReadyLatch;
        if (latch != null) {
            latch.countDown();
        }
    }

    /**
     * Web 侧回报：第 `index` 帧已经画好了，可以抓了。
     *
     * 只认当前这一帧的序号 —— 慢一拍到达的回报会把后面那帧提前放行，
     * 录出来就是一串跳帧。
     */
    public void notifyFrameReady(int index) {
        CountDownLatch latch = frameReadyLatch;
        if (latch != null && index == frameIndex) {
            latch.countDown();
        }
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
             * 屏幕方向：导出期间页面是竖的还是横的由 Web 侧决定，这里只按实际
             * 输出的宽高写。录完发现是躺着的，改页面方向再来一次即可。
             */
            muxer.setOrientationHint(0);

            captureBitmap = Bitmap.createBitmap(spec.width, spec.height, Bitmap.Config.ARGB_8888);
        } catch (Throwable error) {
            android.util.Log.e(TAG, "编码器起不来", error);
            fail("这台机器的 H.264 编码器起不来，导出中止。");
            return;
        }
        worker.post(this::stepFrame);
    }

    /** 一帧的循环：请求 → 等回报 → 抓 → 编 → 下一帧。 */
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
        CountDownLatch latch = new CountDownLatch(1);
        frameReadyLatch = latch;
        mainHandler.post(() -> listener.onFrameRequested(index, timeSec));

        try {
            if (!latch.await(FRAME_READY_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                android.util.Log.w(TAG, "第 " + index + " 帧没有等到渲染回报，跳过");
            } else {
                captureAndEncode(index);
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            finish();
            return;
        }

        frameIndex += 1;
        mainHandler.post(() -> listener.onProgress(Math.min(frameIndex, spec.totalFrames), spec.totalFrames));
        worker.post(this::stepFrame);
    }

    /** 抓这一帧并交给编码器。抓不到就留空（黑底），不让整条导出挂掉。 */
    private void captureAndEncode(int index) {
        Bitmap frame = captureFrame();
        Canvas canvas = null;
        try {
            canvas = inputSurface.lockCanvas(null);
            canvas.drawColor(spec.backgroundColor);
            if (frame != null) {
                canvas.drawBitmap(frame, null,
                        new android.graphics.RectF(0, 0, spec.width, spec.height), paint);
            }
        } catch (Throwable error) {
            android.util.Log.w(TAG, "第 " + index + " 帧写入编码器失败", error);
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

    /**
     * 抓主窗口当前这一帧。
     *
     * `PixelCopy` 抓的是**这个窗口**合成之后的内容，别的窗口（通知、悬浮窗）不会混进来
     * —— 所以进度提示放在原生通知里是安全的，而放在 Web 页面上就会被一起录进去。
     */
    private Bitmap captureFrame() {
        if (captureRect == null) {
            android.view.View decor = window.getDecorView();
            int width = decor.getWidth();
            int height = decor.getHeight();
            if (width <= 0 || height <= 0) {
                return null;
            }
            captureRect = new Rect(0, 0, width, height);
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return null;
        }
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicBoolean ok = new AtomicBoolean(false);
        try {
            PixelCopy.request(window, captureRect, captureBitmap,
                    result -> {
                        ok.set(result == PixelCopy.SUCCESS);
                        latch.countDown();
                    },
                    mainHandler);
        } catch (Throwable error) {
            android.util.Log.w(TAG, "PixelCopy 调用失败", error);
            return null;
        }
        try {
            latch.await(CAPTURE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return null;
        }
        return ok.get() ? captureBitmap : null;
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
                android.util.Log.w(TAG, "EOS 发不出去", error);
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
                    android.util.Log.w(TAG, "写入 muxer 失败", error);
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
            android.util.Log.w(TAG, "收尾排空失败", error);
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
            android.util.Log.w(TAG, "muxer 释放失败", error);
        }
        muxer = null;
        try {
            if (codec != null) {
                codec.stop();
                codec.release();
            }
        } catch (Throwable error) {
            android.util.Log.w(TAG, "编码器释放失败", error);
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
        captureBitmap = null;
        if (workerThread != null) {
            workerThread.quitSafely();
            workerThread = null;
            worker = null;
        }
    }
}
