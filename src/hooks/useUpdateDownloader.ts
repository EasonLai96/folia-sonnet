import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadUpdateApk, installUpdateApk } from '../services/appUpdate';
import { watchUpdateDownloadProgress, type FoliaNativeListenerHandle } from '../platform/foliaNative';

// src/hooks/useUpdateDownloader.ts
// 应用内更新的下载状态机：idle → downloading（带进度）→ downloaded，失败进 failed。
//
// 抽成一个 hook 是因为两个入口要用它：设置 → 帮助页里的手动检查，以及启动时的自动提示。
// 两处做的是同一串动作（原生下载 → 进度事件 → 系统安装器），没必要写两遍。
//
// 平台判断不在 hook 里做 —— 由调用方决定要不要挂载。桌面端没有这套原生桥，
// 挂上去也只会拿到 reject。

/** 下载阶段。 */
export type UpdateDownloadPhase =
    | { kind: 'idle' }
    | { kind: 'downloading'; receivedBytes: number; totalBytes: number; percent: number }
    | { kind: 'downloaded'; path: string }
    | { kind: 'failed'; message: string };

/** 要下载的那个安装包。 */
export type UpdateDownloadTarget = {
    downloadUrl: string;
    version: string;
    /** 清单给的预期体积；为 0 表示未知，进度条退化成「已下载 N MB」。 */
    sizeBytes: number;
};

export type UpdateDownloader = {
    state: UpdateDownloadPhase;
    /** 安装这一步的额外说明：`permission-required` 表示已经跳了授权设置页。 */
    installNotice: 'none' | 'permission-required';
    startDownload: (target: UpdateDownloadTarget) => Promise<{ path: string; bytes: number } | null>;
    install: () => Promise<{ status: 'installing' | 'permission-required' } | null>;
    reset: () => void;
};

export const useUpdateDownloader = (): UpdateDownloader => {
    const [state, setState] = useState<UpdateDownloadPhase>({ kind: 'idle' });
    const [installNotice, setInstallNotice] = useState<'none' | 'permission-required'>('none');
    /*
     * install() 要读「当下」的 state，但把 state 放进 useCallback 依赖会让引用每次渲染
     * 都变，进而把用它的组件一起带着重渲染。用 ref 读当前值，依赖保持为空。
     */
    const stateRef = useRef(state);
    stateRef.current = state;
    const listenerRef = useRef<FoliaNativeListenerHandle | null>(null);

    /*
     * 进度监听挂在整个组件生命周期上，而不是只在下载那一段 —— 监听器是异步装好的，
     * 点下下载之后再挂就漏掉了头几帧（进度条会从中间开始跳）。
     *
     * 只在 downloading 阶段收：下载完成之后原生那边可能还会再补一帧进度，
     * 那帧带的是旧的字节数，会把「下载完成」冲掉。
     */
    useEffect(() => {
        let disposed = false;
        void watchUpdateDownloadProgress((progress) => {
            if (disposed) return;
            setState((current) => (
                current.kind === 'downloading'
                    ? {
                        kind: 'downloading',
                        receivedBytes: progress.receivedBytes,
                        totalBytes: progress.totalBytes,
                        percent: progress.percent,
                    }
                    : current
            ));
        }).then((listener) => {
            if (disposed) {
                void listener.remove();
                return;
            }
            listenerRef.current = listener;
        }).catch(() => {
            // 桌面端 / 插件不可用：进度条退化成「下载中」，下载仍走系统浏览器兜底。
        });
        return () => {
            disposed = true;
            void listenerRef.current?.remove();
            listenerRef.current = null;
        };
    }, []);

    const startDownload = useCallback(async (target: UpdateDownloadTarget) => {
        setInstallNotice('none');
        setState({ kind: 'downloading', receivedBytes: 0, totalBytes: target.sizeBytes, percent: 0 });
        try {
            const outcome = await downloadUpdateApk(target.downloadUrl, target.version);
            setState({ kind: 'downloaded', path: outcome.path });
            return outcome;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'download-failed';
            setState({ kind: 'failed', message });
            return null;
        }
    }, []);

    const install = useCallback(async () => {
        const current = stateRef.current;
        if (current.kind !== 'downloaded') return null;
        try {
            const outcome = await installUpdateApk(current.path);
            // 没授权时原生已经把设置页拉起来了，界面要把「授权后回来再点一次」说清楚。
            setInstallNotice(outcome.status === 'permission-required' ? 'permission-required' : 'none');
            return outcome;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'download-failed';
            setState({ kind: 'failed', message });
            return null;
        }
    }, []);

    const reset = useCallback(() => {
        setInstallNotice('none');
        setState({ kind: 'idle' });
    }, []);

    return { state, installNotice, startDownload, install, reset };
};
