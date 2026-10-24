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
 * 位置**只在状态边界过桥**（ready / playing / paused / buffering / seeked / ended）：
 * 播放器内部每 250ms 采一次位置，但那一拍只喂原生锚点（壁纸 / 悬浮窗 / 通知栏），
 * 不再注入主 WebView。Web 侧按本地墙钟从最后一次状态位置往前推
 * （见 `nativePlaybackEngine.getPositionSec`）—— 每 500ms 灌一次 JS 正是
 * 「App 内歌词可视化隔几秒顿一下」的来源，见 `onEvent` 里那段说明。
 *
 * 别改成 Web 侧定时调 getSnapshot：Capacitor 的桥只有一条，
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
     * 判断"这一拍的采样值要不要写进锚点"的容差：与播放器上报位置的周期一致。
     *
     * 见写锚点那一段的说明 —— 差在这么点以内就当作「外推是准的」，不把时间轴往回拽。
     * 改播放器那个 `POSITION_TICK_MS` 时这里要跟着改。
     */
    private static final long POSITION_TICK_MS = 250L;

    /** 采样值与「墙钟外推出来的位置」差不到一个采样周期：这一拍没有新信息。 */
    private static boolean anchorStillTrue(long sampledMs) {
        long gap = WallpaperLyricsState.get().positionMs() - sampledMs;
        return gap < POSITION_TICK_MS && gap > -POSITION_TICK_MS;
    }

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
                /*
                 * 桌面歌词（壁纸 / 悬浮小窗 / 锁屏）的时间轴锚点：由播放器自己给，
                 * **就在这里写**，不再绕一次主线程 —— 锚点记的是「收到这个位置的那一刻」，
                 * 晚一点写（哪怕只是排到下一轮主线程消息）都会让外推偏慢一截。
                 * `WallpaperLyricsState` 那几个字段是 volatile 的，跨线程写没问题。
                 */
                if ("position".equals(type) || "playing".equals(type)
                    || "paused".equals(type) || "ready".equals(type) || "seeked".equals(type)) {
                    /*
                     * seeked 既可能是播放中的单曲循环，也可能是暂停时拖进度条：
                     * 不能用「不是 paused 就算在播」推，问播放器自己。
                     */
                    boolean playing = "seeked".equals(type)
                        ? (player != null && player.isPlaying())
                        : !"paused".equals(type);
                    /*
                     * ⭐ **"position" 这一档不是每次都写锚点。**
                     *
                     * 每 250ms 无条件 `setAnchor(采样值)` 之前，桌面歌词就是「放着放着
                     * 往回抽一下」，而且壁纸与叠层一起抽 —— 两处其实只是同一个锚点的
                     * 两个读者：
                     *   · 壁纸 / 悬浮小窗是原生自绘，直接读 `positionMs()`
                     *     （锚点 + 墙钟外推），锚点被往回写一次，画面就往回跳一次；
                     *   · 叠层是另一个 WebView，它**只在签名变了的时候才收一次推送**
                     *     （WallpaperOverlay 的 lastSignature，签名里含 anchorPositionMs），
                     *     其余时间自己按 rAF 往前插值 —— 这是刻意的设计，不是省事。
                     *     锚点每 250ms 一变，就等于每 250ms 推一次：页面每次都把
                     *     「自己已经走了 250ms」的时钟重设成那个采样值，于是它也往回抽。
                     *     商籁那种「按位置选景」的视觉器上更明显：位置一抖当前那一景就换，
                     *     背景的装饰文字跟着一会大一会小、位置乱跑。
                     *
                     * 采样值天然比"墙钟外推出来的位置"慢一点（播放器位置的更新粒度、
                     * 这一下回调排到线程上的那点延迟）。1 倍速下外推速率与真实速率都是
                     * 1.0，**这个差值是恒定的、不会累积**，所以「差得不多就干脆不写」
                     * 是安全的：让墙钟照旧往前走，代价只是一个看不见的恒定滞后。
                     * 差超过一个采样周期才是真出事了（缓冲 / 欠载 / 卡顿：位置停着而
                     * 墙钟还在走），那时候必须往回对齐。
                     *
                     * 其余几档（playing / paused / ready）一律照写：它们是状态边界，
                     * 锚点必须以它们为准。
                     */
                    /*
                     * 只有 **1 倍速**才走这条优化。
                     *
                     * 外推是「锚点 + 墙钟」，速率恒为 1.0；倍速下真实位置走得更快，
                     * 差值会线性累积、每过一会儿就撞一次容差 —— 那反而变成「隔几秒
                     * 抽一下」。倍速时不跳过，照旧每拍写（跟改之前一样），不引入回归。
                     * 真要把倍速也抹平，得让 WallpaperLyricsState 的外推带上速率。
                     */
                    boolean unityRate = player != null && Math.abs(player.getSpeed() - 1f) < 0.01f;
                    if ("position".equals(type) && playing && unityRate && anchorStillTrue(positionMs)) {
                        // 差在一个采样周期内：这个采样值没有信息量，不写。
                    } else {
                        WallpaperLyricsState.setAnchor(positionMs, playing);
                    }
                }
                /*
                 * ⭐ **位置的每一拍不再过桥。**
                 *
                 * App 内（主 WebView）原来每 250ms（后来降到 500ms）就会被
                 * `evaluateJavascript` 灌一次 JS。掉帧打点对上的正是这个节拍：
                 * 主线程上每隔 500ms 多出一帧 `syncAndDrawFrame` 的等待，掉帧成簇出现，
                 * 而 App 外的悬浮小窗 / 叠层几乎不卡 —— 它们不收这条事件。
                 *
                 * 这笔开销不在数据量上，在「往 WebView 里塞一次 JS」这件事本身：
                 * 要切进 JS 上下文、排到渲染流水线前面，还给 GC 添一份垃圾。
                 * 降频只是把「每 250ms 一次」变成「每 500ms 一次」，节拍还在；
                 * 所以现在干脆不发 —— 只把**状态边界**（ready / playing / paused /
                 * buffering / ended / error / idle）过桥，位置由 Web 侧自己的墙钟
                 * 从最后一次锚点往前推（见 nativePlaybackEngine.getPositionSec）。
                 *
                 * 锚点**照旧每 250ms 算一次**（就在上面），壁纸 / 悬浮窗 / 叠层的
                 * 时间轴精度一点没降 —— 那一侧读的是锚点，不是这条事件。
                 * 通知栏 / 锁屏的进度条也直接问播放器（FoliaPlaybackService），
                 * 不经过 WebView。
                 */
                if ("position".equals(type)) {
                    return;
                }
                /*
                 * 只有状态边界才需要构造 payload / 过桥。位置那一拍在上面已经 return，
                 * 不在这里给播放器线程添垃圾。
                 */
                JSObject payload = new JSObject();
                payload.put("type", type);
                payload.put("positionMs", (double) positionMs);
                payload.put("durationMs", (double) durationMs);
                if (message != null) {
                    payload.put("message", message);
                }
                /*
                 * 过桥那一下回主线程：`notifyListeners` 里的监听器表不是为并发写的
                 * （`Plugin.eventListeners` 是个普通 HashMap，加 / 删监听器在 JS 那一侧）。
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

    /**
     * 通知栏镜像切歌用：跳过 JS，直接给播放器换源。
     *
     * 「下一首/上一首」的确认计时器超时（WebView 冻结，JS 没回话）时，服务从镜像
     * 队列取出相邻条目走这里。播放器内部自己处理线程（与 resumeFromSystem 同纪律）。
     */
    public static void prepareFromSystem(String url) {
        FoliaNativePlayerPlugin current = instance;
        if (current == null || current.player == null || url == null || url.isEmpty()) return;
        current.player.prepare(url, -1L);
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
     * 播放器壳子在不在（不要求手上正拿着歌）。
     *
     * 镜像兜底切歌的资格判据用这个而不是 {@link #hasActiveMedia()}：当前这首完全可能
     * 走的是 {@code <audio>}（有缓存的歌回落网页播放，原生手上没东西）—— 按
     * hasActiveMedia 判，WebView 一冻结，通知栏切歌就永远没人接。JS 没回话的那一刻
     * 原生直接 prepare 一条新地址接管播放，不需要原生「之前就在播」。
     */
    public static boolean hasPlayer() {
        FoliaNativePlayerPlugin current = instance;
        return current != null && current.player != null;
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
