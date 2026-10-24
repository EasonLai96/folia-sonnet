package top.izuna.foliamajor;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 通知栏/锁屏/耳机按键发来的播放控制指令。
 *
 * 走清单注册的接收器而不是 Activity 里的动态接收器：动态接收器只在 Activity
 * 存活时有效，而用户点通知栏时应用往往就在后台 —— 那时指令会全部丢失。
 *
 * 接到指令后交给 Capacitor 插件实例，由它 notifyListeners 派发给 Web 层，
 * 原生侧不另起一套播放器状态机。
 */
public class FoliaCommandReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) {
            return;
        }
        String command = intent.getStringExtra(FoliaPlaybackService.EXTRA_COMMAND);
        if (command == null || command.isEmpty()) {
            return;
        }
        // 只有 seek 带位置；其余命令拿到的是默认值 0，Web 层不会去读。
        long positionMs = intent.getLongExtra(FoliaPlaybackService.EXTRA_COMMAND_POSITION, 0L);
        FoliaPlaybackPlugin.dispatchCommandFromReceiver(command, positionMs);
        // 红心命令额外挂一个原生兜底：命令已经广播给 JS 了，但 WebView 冻结时它不会回话，
        // 服务的确认计时器（LIKE_FALLBACK_MS）发现没回话就直接对各平台补写收藏。
        // MediaSession 那条路（锁屏/车机的 CustomAction）在服务回调里挂，走不到这里。
        if ("like".equals(command) && FoliaPlaybackService.isRunning()) {
            Intent fallback = new Intent(context, FoliaPlaybackService.class);
            fallback.setAction(FoliaPlaybackService.ACTION_SCHEDULE_LIKE_FALLBACK);
            try {
                context.startService(fallback);
            } catch (Throwable ignored) {
                // 服务起不来就没有兜底，JS 那条路照常。
            }
        }
    }
}
