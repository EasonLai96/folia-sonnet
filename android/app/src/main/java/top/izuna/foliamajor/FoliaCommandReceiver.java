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
 * 两类来路分开处理：
 * - **用户按的按钮**（通知栏三键、锁屏面板，带 EXTRA_FROM_BUTTONS）：
 *   next / previous / like 先转进服务 —— 兜底计时器（镜像换源、原生补写红心）
 *   只有服务自己能挂，以前这里直派 JS，WebView 一冻结整排按钮就是死的；
 *   JS 那份命令由服务统一发，这里不再直派，免得两份。
 * - **服务转来的回话**（sendCommand 的广播，不带标记）：直派 JS。
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
        String songKey = intent.getStringExtra(FoliaPlaybackService.EXTRA_SONG_KEY);

        if (intent.getBooleanExtra(FoliaPlaybackService.EXTRA_FROM_BUTTONS, false)) {
            switch (command) {
                case "next":
                case "previous":
                case "like":
                    forwardToService(context, command, positionMs);
                    return;
                default:
                    break;
            }
        }
        FoliaPlaybackPlugin.dispatchCommandFromReceiver(command, positionMs, songKey);
    }

    /** 用户按钮转进服务。服务没在跑（理论上按钮存在即服务在前台）就退回直派 JS。 */
    private void forwardToService(Context context, String command, long positionMs) {
        if (FoliaPlaybackService.isRunning()) {
            Intent service = new Intent(context, FoliaPlaybackService.class);
            service.setAction(FoliaPlaybackService.ACTION_MEDIA_COMMAND);
            service.putExtra(FoliaPlaybackService.EXTRA_COMMAND, command);
            service.putExtra(FoliaPlaybackService.EXTRA_COMMAND_POSITION, positionMs);
            try {
                context.startService(service);
                return;
            } catch (Throwable ignored) {
                // 服务起不来就没有兜底，JS 那条路照常。
            }
        }
        FoliaPlaybackPlugin.dispatchCommandFromReceiver(command, positionMs, null);
    }
}
