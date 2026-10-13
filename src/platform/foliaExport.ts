import { Capacitor, registerPlugin } from '@capacitor/core';

// src/platform/foliaExport.ts
// 把歌词动画录成视频的 Web 侧入口。原生实现见 android/.../export/。
//
// 为什么要有它：「渲染导出」原本只是一个 Folium 模组（mods/sample-transparent-mov-export），
// 而模组只在桌面端 Electron 上加载 —— 安卓这边 `src/mods/ipc.ts` 没有 bridge 可用，
// `reloadMods()` 返回空数组，所以在手机上它连列表里都看不见。这一层是那条能力在
// 安卓上的替身，直接由控制面板那一页叫，不经过任何模组。
//
// 和桌面端那个模组有一个**本质区别**：它导出的是**不透明**的 MP4。
// 安卓 MediaCodec 的 VP8/VP9/AV1 都不支持 alpha 通道，HEVC alpha / ProRes 也没有，
// 想保住透明只能往 APK 里塞第三方编码器 —— 不划算。所以录的是屏幕上真实看到的那一幅
// 画面（主窗口本来就有不透明底色），而不是"抠掉背景"的那一版。

export type VideoExportListenerHandle = { remove: () => Promise<void> };

/** 原生请求「把画面推到第 index 帧」。 */
export type VideoExportFrameRequest = {
    index: number;
    timeSec: number;
};

/** 原生回报的进度 / 结果。 */
export type VideoExportProgress = {
    state: 'running' | 'done' | 'error' | 'cancelled';
    frame?: number;
    total?: number;
    /** 成功后给人看的位置描述（相册里的一行，或者文件路径）。 */
    path?: string;
    /** 失败时可以直接显示给用户的一句话。 */
    message?: string;
};

export type VideoExportSpec = {
    width: number;
    height: number;
    fps: number;
    bitrateMbps: number;
    totalFrames: number;
    startSec: number;
    /** 兜底底色（0xAARRGGBB，按有符号 32 位传）。抓帧失败那一帧会用它补上。 */
    backgroundColor: number;
};

interface FoliaExportPlugin {
    isSupported(): Promise<{ supported: boolean; reason: string }>;
    start(options: VideoExportSpec): Promise<void>;
    cancel(): Promise<void>;
    notifyFrameReady(options: { index: number }): Promise<void>;
    addListener(
        eventName: 'foliaExportFrame',
        listener: (request: VideoExportFrameRequest) => void,
    ): Promise<VideoExportListenerHandle>;
    addListener(
        eventName: 'foliaExportProgress',
        listener: (progress: VideoExportProgress) => void,
    ): Promise<VideoExportListenerHandle>;
}

const FoliaExport = registerPlugin<FoliaExportPlugin>('FoliaExport');

/** 只在这条通道真正可用时为真：Capacitor 安卓包，且插件注册过了。 */
export const isVideoExportAvailable = (): boolean => (
    Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
);

/**
 * 这台机器能不能导出。
 *
 * 主要挡的是安卓 8.0 以下 —— `PixelCopy` 是 API 26 才有的，而 WebView 的内容
 * 只存在于合成后的 Surface 上，`View.draw()` 画不出来，没有替代路径。
 */
export const checkVideoExportSupport = async (): Promise<{ supported: boolean; reason: string }> => {
    if (!isVideoExportAvailable()) {
        return { supported: false, reason: '' };
    }
    try {
        const result = await FoliaExport.isSupported();
        return { supported: Boolean(result?.supported), reason: result?.reason ?? '' };
    } catch {
        // 插件没注册（旧包）：当作不支持，界面上给桌面端提示。
        return { supported: false, reason: '' };
    }
};

export const startVideoExport = async (spec: VideoExportSpec): Promise<void> => {
    await FoliaExport.start(spec);
};

export const cancelVideoExport = async (): Promise<void> => {
    try {
        await FoliaExport.cancel();
    } catch {
        // 已经结束了。
    }
};

/** 回报「第 index 帧画好了，可以抓了」。 */
export const notifyExportFrameReady = async (index: number): Promise<void> => {
    try {
        await FoliaExport.notifyFrameReady({ index });
    } catch {
        // 导出已经结束，这一帧无所谓了。
    }
};

export const watchExportFrameRequests = (
    listener: (request: VideoExportFrameRequest) => void,
): Promise<VideoExportListenerHandle> => (
    FoliaExport.addListener('foliaExportFrame', listener)
);

export const watchExportProgress = (
    listener: (progress: VideoExportProgress) => void,
): Promise<VideoExportListenerHandle> => (
    FoliaExport.addListener('foliaExportProgress', listener)
);
