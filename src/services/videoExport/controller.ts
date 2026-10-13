import {
    cancelVideoExport,
    checkVideoExportSupport,
    startVideoExport as callStartVideoExport,
    watchExportProgress,
    type VideoExportListenerHandle,
    type VideoExportSpec,
} from '../../platform/foliaExport';
import { writeExportRenderConfig, type ExportRenderConfig } from './exportConfig';

// src/services/videoExport/controller.ts
// 导出这条链路的状态机。面板那一页只负责发起和显示，监听部分常驻在 App 里。
//
// 为什么监听不能挂在面板上：导出期间面板会被收起来（面板一开就挡着画面），
// 挂在它里面的监听就跟着卸载了 —— 之后原生回报的进度一个都收不到，
// 界面会一直停在「导出中」不再动。所以这里做成模块级：谁在显示都不影响它在跑。
//
// 注意这里**没有**帧驱动：画面由原生那边的离屏渲染页自己推
// （见 android/.../export/ExportRenderView），主应用全程不参与时钟。

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

let progressHandle: VideoExportListenerHandle | null = null;
let installed = false;

/** 装上进度监听。在 App 里调一次，卸载时把返回的清理函数跑掉。 */
export const installVideoExportBridge = (): (() => void) => {
    if (installed) {
        return () => undefined;
    }
    installed = true;

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
        installed = false;
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
        void progressHandle?.remove();
        progressHandle = null;
    };
};

/**
 * 开始一次导出。
 *
 * `config` 先落到 localStorage —— 离屏渲染页是另一个 WebView，两端之间没有桥，
 * 这是唯一能把「拍哪首歌、哪个模式、什么主题」送过去的地方（见 exportConfig.ts）。
 * 写不进去就没法拍（渲染页拿不到歌词），直接报出来，别让用户干等。
 */
export const beginVideoExport = async (
    spec: VideoExportSpec,
    config: ExportRenderConfig,
): Promise<boolean> => {
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
    if (!writeExportRenderConfig(config)) {
        publish({
            status: 'error',
            frame: 0,
            total: 0,
            path: null,
            message: null,
        });
        return false;
    }
    installVideoExportBridge();
    publish({ status: 'running', frame: 0, total: spec.totalFrames, path: null, message: null });
    try {
        await callStartVideoExport(spec);
        return true;
    } catch (error) {
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
