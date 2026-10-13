package top.izuna.foliamajor.export;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.Log;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileDescriptor;

/**
 * 「把歌词动画录成视频」的桥。原生实现见同目录的 VideoExportSession。
 *
 * 这一层只管三件事：把输出文件准备好、把会话跑起来、把状态和每帧的请求转给 Web 层。
 * 画面怎么走、时钟怎么推都是 Web 侧的事 —— 那里才有可视化。
 *
 * 为什么要做成插件而不是模组：模组在安卓上压根加载不了（见 `src/mods/ipc.ts`，
 * 没有 Electron bridge 时 `reloadMods()` 返回空数组），而导出这条能力原本只存在于
 * 桌面端。做成插件，控制面板那一页就能直接叫它。
 */
@CapacitorPlugin(name = "FoliaExport")
public class FoliaExportPlugin extends Plugin {

    private static final String TAG = "FoliaExportPlugin";

    private static final String EVENT_FRAME = "foliaExportFrame";
    private static final String EVENT_PROGRESS = "foliaExportProgress";

    /**
     * 导出上限。
     *
     * 抓帧是「一次 PixelCopy 换一帧」，比实时慢得多（1080p 上一帧几十毫秒很常见），
     * 不封顶的话用户随手一点就是十几分钟。15 分钟 / 1080p / 60fps 和桌面端那一档对齐。
     */
    private static final int MAX_FRAMES = 60 * 60 * 15;
    private static final int MAX_PIXELS = 3840 * 2160;

    private VideoExportSession session;
    private ParcelFileDescriptor outputFd;
    private boolean keepScreenOn = false;

    @Override
    protected void handleOnDestroy() {
        stopSession(true);
        super.handleOnDestroy();
    }

    /** 这台机器能不能导出。Web 侧据此决定要不要显示那一页。 */
    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject out = new JSObject();
        boolean supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O;
        out.put("supported", supported);
        out.put("reason", supported
                ? ""
                : "抓屏需要安卓 8.0（API 26）以上，这台机器是 " + Build.VERSION.SDK_INT + "。");
        call.resolve(out);
    }

    @PluginMethod
    public void start(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity unavailable; cannot start an export.");
            return;
        }
        if (session != null) {
            call.reject("An export is already running.");
            return;
        }

        int width = call.getInt("width", 1080);
        int height = call.getInt("height", 1920);
        int fps = call.getInt("fps", 30);
        int bitrateMbps = call.getInt("bitrateMbps", 12);
        int totalFrames = call.getInt("totalFrames", 0);
        double startSec = call.getDouble("startSec", 0d);
        int backgroundColor = call.getInt("backgroundColor", 0xFF000000);

        width = even(clamp(width, 160, 3840));
        height = even(clamp(height, 160, 2160));
        fps = clamp(fps, 12, 60);
        bitrateMbps = clamp(bitrateMbps, 2, 60);
        if (totalFrames <= 0) {
            call.reject("totalFrames must be positive.");
            return;
        }
        if (totalFrames > MAX_FRAMES) {
            call.reject("Too many frames: " + totalFrames + " (max " + MAX_FRAMES + ").");
            return;
        }
        if (width * height > MAX_PIXELS) {
            call.reject("Resolution too large.");
            return;
        }

        final String fileName = "folia-lyrics-" + System.currentTimeMillis() + ".mp4";
        FileDescriptor fd;
        String label;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // 走 MediaStore：不用申请存储权限，录完直接在相册里。
                ContentValues values = new ContentValues();
                values.put(MediaStore.Video.Media.DISPLAY_NAME, fileName);
                values.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
                values.put(MediaStore.Video.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_MOVIES + "/Folia");
                values.put(MediaStore.Video.Media.IS_PENDING, 1);
                ContentResolver resolver = activity.getContentResolver();
                Uri uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    call.reject("Could not create the output file.");
                    return;
                }
                outputFd = resolver.openFileDescriptor(uri, "w");
                if (outputFd == null) {
                    call.reject("Could not open the output file.");
                    return;
                }
                fd = outputFd.getFileDescriptor();
                label = Environment.DIRECTORY_MOVIES + "/Folia/" + fileName;
                // 录完再把它从「待处理」放开，否则相册里会出现一个打不开的占位。
                pendingUri = uri;
            } else {
                File dir = activity.getExternalFilesDir(Environment.DIRECTORY_MOVIES);
                if (dir != null && !dir.exists() && !dir.mkdirs()) {
                    Log.w(TAG, "导出目录建不出来，退回私有 files 目录");
                }
                File file = new File(dir != null ? dir : activity.getFilesDir(), fileName);
                java.io.FileOutputStream stream = new java.io.FileOutputStream(file);
                fd = stream.getFD();
                rawStream = stream;
                label = file.getAbsolutePath();
            }
        } catch (Throwable error) {
            Log.e(TAG, "输出文件开不出来", error);
            call.reject("Could not create the output file.");
            return;
        }

        setKeepScreenOn(activity, true);

        VideoExportSession.Spec spec = new VideoExportSession.Spec(
                width, height, fps, bitrateMbps, totalFrames, startSec, backgroundColor);
        session = new VideoExportSession(activity.getWindow(), fd, label, spec,
                new VideoExportSession.Listener() {
                    @Override
                    public void onFrameRequested(int index, double timeSec) {
                        JSObject payload = new JSObject();
                        payload.put("index", index);
                        payload.put("timeSec", timeSec);
                        notifyListeners(EVENT_FRAME, payload);
                    }

                    @Override
                    public void onProgress(int frame, int total) {
                        JSObject payload = new JSObject();
                        payload.put("state", "running");
                        payload.put("frame", frame);
                        payload.put("total", total);
                        notifyListeners(EVENT_PROGRESS, payload);
                    }

                    @Override
                    public void onCompleted(String path) {
                        JSObject payload = new JSObject();
                        payload.put("state", "done");
                        payload.put("path", path);
                        notifyListeners(EVENT_PROGRESS, payload);
                        stopSession(false);
                    }

                    @Override
                    public void onFailed(String message) {
                        JSObject payload = new JSObject();
                        payload.put("state", "error");
                        payload.put("message", message);
                        notifyListeners(EVENT_PROGRESS, payload);
                        stopSession(true);
                    }

                    @Override
                    public void onCancelled() {
                        JSObject payload = new JSObject();
                        payload.put("state", "cancelled");
                        notifyListeners(EVENT_PROGRESS, payload);
                        stopSession(true);
                    }
                });
        session.start();
        call.resolve();
    }

    /** 用户点取消。已经录下的那部分仍然会收尾成一个能播的片段。 */
    @PluginMethod
    public void cancel(PluginCall call) {
        if (session == null) {
            call.resolve();
            return;
        }
        session.cancel();
        call.resolve();
    }

    /** Web 侧回报：第 `index` 帧已经画好了，可以抓了。 */
    @PluginMethod
    public void notifyFrameReady(PluginCall call) {
        Integer index = call.getInt("index");
        if (session != null && index != null) {
            session.notifyFrameReady(index);
        }
        call.resolve();
    }

    private Uri pendingUri;
    private java.io.FileOutputStream rawStream;

    private void stopSession(boolean discard) {
        VideoExportSession current = session;
        session = null;
        if (current != null) {
            // 会话自己是异步收尾的，这里只断引用：真正释放发生在它自己的 finish() 里。
            if (discard) {
                current.cancel();
            }
        }
        closeOutput(discard);
        Activity activity = getActivity();
        if (activity != null) {
            setKeepScreenOn(activity, false);
        }
    }

    private void closeOutput(boolean discard) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && pendingUri != null) {
            Activity activity = getActivity();
            if (activity != null) {
                ContentValues values = new ContentValues();
                // 丢掉（失败/取消）的时候也放开，否则相册里会留一个灰占位。
                values.put(MediaStore.Video.Media.IS_PENDING, discard ? 1 : 0);
                try {
                    activity.getContentResolver().update(pendingUri, values, null, null);
                } catch (Throwable error) {
                    Log.w(TAG, "收尾 MediaStore 记录失败", error);
                }
            }
            pendingUri = null;
        }
        try {
            if (outputFd != null) {
                outputFd.close();
            }
        } catch (Throwable error) {
            Log.w(TAG, "关闭输出 fd 失败", error);
        }
        outputFd = null;
        try {
            if (rawStream != null) {
                rawStream.close();
            }
        } catch (Throwable error) {
            Log.w(TAG, "关闭输出流失败", error);
        }
        rawStream = null;
    }

    /**
     * 导出期间保持屏幕亮着。
     *
     * 抓帧要求画面真的在屏幕上；中途息屏的话合成停了，PixelCopy 只会拿到失败或者
     * 最后一帧 —— 录出来就是后面一整段静止画面。
     */
    private void setKeepScreenOn(Activity activity, boolean on) {
        if (keepScreenOn == on) {
            return;
        }
        keepScreenOn = on;
        try {
            activity.runOnUiThread(() -> {
                if (on) {
                    activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        } catch (Throwable error) {
            Log.w(TAG, "屏幕常亮开关失败", error);
        }
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    /** H.264 要求宽高都是偶数。 */
    private static int even(int value) {
        return value % 2 == 0 ? value : value - 1;
    }
}
