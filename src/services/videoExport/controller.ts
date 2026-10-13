import { lyricCurrentTime } from '../../stores/motionSignals';
import {
    cancelVideoExport,
    checkVideoExportSupport,
    notifyExportFrameReady,
    startVideoExport as callStartVideoExport,
    watchExportFrameRequests,
    watchExportProgress,
    type VideoExportListenerHandle,
    type VideoExportSpec,
} from '../../platform/foliaExport';

// src/services/videoExport/controller.ts
// 导出这条链路的状态机与帧驱动。面板那一页只负责发起和显示，驱动部分常驻在 App 里。
//
// 为什么驱动不能挂在面板上：导出期间必须**关掉面板**——PixelCopy 抓的是整个窗口合成
// 之后的内容，面板只要还在画面上就会被一起录进去。而面板一关，挂在它里面的监听
// 就跟着卸载了，原生那边每一帧都等不到回报（4 秒超时跳过），录出来就是一串空帧。
// 所以这里做成模块级：谁在显示都不影响它在跑。

export type VideoExportStatus =
    | 'idle'
    /** 这台机器/这个包不支持（非安卓、安卓 8.0 以下、插件没注册）。 */
    | 'unsupported'
    | 'running'
    | 'done'
    | 'cancelled'
    | 'error';

export type VideoExportSnapshot = {
    status: VideoExportStatus;
    frame: number;
    total: number;
    /** 成功后给人看的位置描述。 */
    path: string | null;
    /** 失败 / 不支持时可以直接显示的一句话。 */
    message: string | null;
};

const IDLE: VideoExportSnapshot = {
    status: 'idle',
    frame: 0,
    total: 0,
    path: null,
    message: null,
};

let snapshot: VideoExportSnapshot = IDLE;
let version = 0;
const listeners = new Set<() => void>();

const publish = (next: VideoExportSnapshot): void => {
    snapshot = next;
    version += 1;
    listeners.forEach(notify => notify());
};

export const getVideoExportSnapshot = (): VideoExportSnapshot => snapshot;
export const getVideoExportVersion = (): number => version;
export const subscribeVideoExport = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/**
 * 时钟是不是被导出接管了。
 *
 * `usePlaybackVisualizerBridge` 的 rAF 在播放时每帧写一次 `lyricCurrentTime`；
 * 导出期间画面得由导出循环推，两边同时写就是画面乱跳。正常流程里导出开始前会先
 * 暂停播放，这一条挡的是「用户在导出途中又按了播放」。
 */
let clockTakenOver = false;
/** 时钟是否被导出接管。见上面的说明。 */
export const isExportClockTakenOver = (): boolean => clockTakenOver;

let frameHandle: VideoExportListenerHandle | null = null;
let progressHandle: VideoExportListenerHandle | null = null;
let installed = false;

/**
 * 装上帧驱动。在 App 里调一次，卸载时把返回的清理函数跑掉。
 *
 * 「画好了」不是设置完 motion value 就算数：写入的那一帧只是改了值，画面要到
 * **下一帧**才按新值重画。所以等两帧再回报 —— 等一帧会稳定地录到「上一帧的画面」，
 * 整条视频看起来就是慢半拍。
 */
export const installVideoExportBridge = (): (() => void) => {
    if (installed) {
        return () => undefined;
    }
    installed = true;

    void watchExportFrameRequests(({ index, timeSec }) => {
        lyricCurrentTime.set(timeSec);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            void notifyExportFrameReady(index);
        }));
    }).then(handle => {
        frameHandle = handle;
    });

    void watchExportProgress(progress => {
        if (progress.state === 'running') {
            publish({
                status: 'running',
                frame: progress.frame ?? 0,
                total: progress.total ?? 0,
                path: null,
                message: null,
            });
            return;
        }
        clockTakenOver = false;
        installed = false;
        void frameHandle?.remove();
        frameHandle = null;
        void progressHandle?.remove();
        progressHandle = null;
        if (progress.state === 'done') {
            publish({ status: 'done', frame: 0, total: 0, path: progress.path ?? null, message: null });
            return;
        }
        if (progress.state === 'cancelled') {
            publish({ status: 'cancelled', frame: 0, total: 0, path: null, message: null });
            return;
        }
        publish({
            status: 'error',
            frame: 0,
            total: 0,
            path: null,
            message: progress.message ?? null,
        });
    }).then(handle => {
        progressHandle = handle;
    });

    return () => {
        installed = false;
        clockTakenOver = false;
        void frameHandle?.remove();
        frameHandle = null;
        void progressHandle?.remove();
        progressHandle = null;
    };
};

/**
 * 开始一次导出。
 *
 * `spec` 由调用方按当前歌曲和窗口比例算好；这里只管先确认支持、再接管时钟。
 */
export const beginVideoExport = async (spec: VideoExportSpec): Promise<boolean> => {
    if (snapshot.status === 'running') {
        return false;
    }
    const support = await checkVideoExportSupport();
    if (!support.supported) {
        publish({
            status: 'unsupported',
            frame: 0,
            total: 0,
            path: null,
            message: support.reason || null,
        });
        return false;
    }
    installVideoExportBridge();
    clockTakenOver = true;
    publish({ status: 'running', frame: 0, total: spec.totalFrames, path: null, message: null });
    try {
        await callStartVideoExport(spec);
        return true;
    } catch (error) {
        clockTakenOver = false;
        publish({
            status: 'error',
            frame: 0,
            total: 0,
            path: null,
            message: error instanceof Error ? error.message : null,
        });
        return false;
    }
};

/** 取消。已经录下的那部分仍然会收尾成一个能播的片段。 */
export const cancelActiveExport = async (): Promise<void> => {
    if (snapshot.status !== 'running') {
        return;
    }
    await cancelVideoExport();
};

/** 回到空闲（用户看完成功/失败之后点掉）。 */
export const dismissVideoExportResult = (): void => {
    if (snapshot.status === 'running') {
        return;
    }
    publish(IDLE);
};
