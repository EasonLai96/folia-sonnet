import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  APP_UPDATE_RELEASES_PAGE,
  checkForAppUpdate,
  type AppUpdateCheckResult,
} from '../../../services/appUpdate';
import { useUpdateDownloader } from '../../../hooks/useUpdateDownloader';
import { openExternalUrl } from '../../../utils/openExternalUrl';

// src/components/modal/settings/AndroidUpdateCheck.tsx
// 安卓端的「检查更新」。
//
// 桌面端那套更新 UI 读的是 electron-updater 的状态（window.electron.getUpdateStatus），
// 在 WebView 里恒为空，所以这里单独做一条：
//   拉版本清单（update.json）→ 比版本号 → 原生下载（带进度）→ 下完弹「立即安装」。
//
// 下载交给原生而不是 WebView 里 fetch：APK 动辄上百 MB，在 WebView 里攒 Blob 再转 base64
// 写过桥，中途要同时持有字节数组和膨胀后的字符串，低端机直接 OOM。原生侧是边读边写。
//
// 最后一步必须落到系统安装器 —— Android 不允许应用自己静默装更新，非 Play 分发要装别的
// 包必须让用户点确认。想省掉这一步得走 Play 的 In-App Updates（要求包从 Play 分发），
// 那又是另一条路。
//
// 挂载点：设置的帮助页底部版本区（桌面端的更新提示也在那里）。

// 下载状态机（idle → downloading → downloaded / failed）在 hooks/useUpdateDownloader.ts，
// 启动时的自动提示也用它。

/** 把字节数写成人话，安装包尺寸没必要精确到个位。 */
const formatSize = (bytes: number): string => (
    bytes > 0 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : ''
);

/**
 * 失败码 → 文案 key。
 *
 * 检查和下载分开列：检查失败是「够不着服务器」，下载失败是「拿到了清单但下不下来」，
 * 给用户的建议不一样。认不出来就退回通用的「检查失败」。
 */
const failureKeyOf = (message: string): string => {
    switch (message) {
        case 'manifest-missing': return 'options.androidUpdateFailureManifestMissing';
        case 'timeout': return 'options.androidUpdateFailureTimeout';
        case 'empty-manifest': return 'options.androidUpdateFailureEmptyManifest';
        case 'no-apk': return 'options.androidUpdateFailureNoApk';
        case 'download-timeout': return 'options.androidUpdateFailureDownloadTimeout';
        case 'download-http-error': return 'options.androidUpdateFailureDownloadHttpError';
        case 'download-no-space': return 'options.androidUpdateFailureDownloadNoSpace';
        case 'download-file-error': return 'options.androidUpdateFailureDownloadFileError';
        case 'download-failed': return 'options.androidUpdateFailureDownloadFailed';
        default: return 'options.updateCheckFailed';
    }
};

const AndroidUpdateCheck: React.FC = () => {
    const { t } = useTranslation();
    const [result, setResult] = useState<AppUpdateCheckResult | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const { state: phase, installNotice, startDownload, install, reset } = useUpdateDownloader();
    // 关掉面板时把在飞的请求掐掉：检查更新是个 12 秒超时的网络请求，
    // 组件已经卸载还往回 setState 会白跑一趟。
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => () => abortRef.current?.abort(), []);

    const handleCheck = useCallback(async () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setIsChecking(true);
        // 重新检查就把上一次的下载结果清掉：版本已经变了，上次的"下载完成"不该继续指向旧包。
        reset();
        try {
            const next = await checkForAppUpdate(controller.signal);
            if (!controller.signal.aborted) setResult(next);
        } catch {
            // 只有主动取消会走到这里（其余失败已在服务里翻成 result），什么都不用做。
        } finally {
            if (!controller.signal.aborted) setIsChecking(false);
        }
    }, [reset]);

    const handleOpen = useCallback((url: string) => {
        void openExternalUrl(url).catch(() => {
            // 打不开外链不算功能失败：地址就在上面，用户自己复制也行。
        });
    }, []);

    const handleDownload = useCallback(async () => {
        const release = result && result.status !== 'failed' ? result.release : null;
        const apk = release?.apk;
        if (!apk || !release) return;
        void startDownload({ downloadUrl: apk.downloadUrl, version: release.version, sizeBytes: apk.sizeBytes });
    }, [result, startDownload]);

    const handleInstall = useCallback(async () => {
        void install();
    }, [install]);

    const isAvailable = result?.status === 'update-available';
    const release = result && result.status !== 'failed' ? result.release : null;
    const apk = isAvailable ? result.release.apk : null;
    const isDownloading = phase.kind === 'downloading';
    // 总量未知（服务端没给 Content-Length）时 percent 是 -1，这时候只报已下载量。
    const percent = isDownloading ? Math.max(0, phase.percent) : 0;

    const statusText = (() => {
        if (isChecking) return t('options.updateChecking');
        if (isDownloading) {
            return phase.percent >= 0
                ? `${t('options.androidUpdateDownloading')} ${percent}%`
                : `${t('options.androidUpdateDownloading')} ${formatSize(phase.receivedBytes)}`;
        }
        if (phase.kind === 'downloaded') return t('options.androidUpdateReady');
        if (phase.kind === 'failed') return t(failureKeyOf(phase.message));
        if (!result) return null;
        if (result.status === 'update-available') return t('options.newVersionFound', { version: result.release.version });
        if (result.status === 'up-to-date') return t('options.androidUpdateLatest', { version: result.currentVersion });
        return t(failureKeyOf(result.message));
    })();

    return (
        <div className="mt-1 flex max-w-full flex-col items-center gap-1.5 font-sans text-[11px] leading-snug">
            <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
                {statusText && (
                    <span
                        className={isAvailable || isDownloading || phase.kind === 'downloaded' ? 'font-semibold text-amber-500' : 'opacity-60'}
                        style={isAvailable || isDownloading || phase.kind === 'downloaded' ? undefined : { color: 'var(--text-secondary)' }}
                        data-android-update-status={result?.status ?? 'checking'}
                    >
                        {statusText}
                    </span>
                )}
                <button
                    type="button"
                    onClick={() => void handleCheck()}
                    disabled={isChecking || isDownloading}
                    data-android-update-check="true"
                    className="inline-flex items-center gap-1 opacity-65 transition-colors hover:opacity-100 disabled:opacity-40"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    {isChecking ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                    {t('options.androidUpdateCheck')}
                </button>
            </div>

            {/* 下载 / 安装：有可用更新时这一行才是主角，其余时候只留发布页兜底。 */}
            <div className="flex w-full max-w-sm flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/[0.035] p-1">
                {isAvailable && apk && (
                    <div className="flex w-full flex-col items-center gap-1">
                        {isDownloading && (
                            <>
                                <div
                                    className="h-1 w-full overflow-hidden rounded-full bg-white/10"
                                    role="progressbar"
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={phase.percent >= 0 ? percent : undefined}
                                    data-android-update-progress={String(percent)}
                                >
                                    <div
                                        className="h-full rounded-full bg-amber-500/90 transition-[width] duration-150"
                                        style={{ width: `${phase.percent >= 0 ? percent : 100}%` }}
                                    />
                                </div>
                                <span className="tabular-nums opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {phase.percent >= 0
                                        ? `${percent}% · ${formatSize(phase.receivedBytes)}${phase.totalBytes > 0 ? ` / ${formatSize(phase.totalBytes)}` : ''}`
                                        : formatSize(phase.receivedBytes)}
                                </span>
                            </>
                        )}
                        {!isDownloading && phase.kind !== 'downloaded' && (
                            <button
                                type="button"
                                onClick={() => void handleDownload()}
                                data-android-update-download="true"
                                className="inline-flex w-full items-center justify-center gap-1 rounded-lg px-2 py-1 font-bold opacity-90 transition-colors hover:bg-white/10 hover:opacity-100"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                <Download size={11} />
                                {t('options.androidUpdateDownload')}
                                {apk.sizeBytes > 0 && <span className="font-normal opacity-60">{formatSize(apk.sizeBytes)}</span>}
                            </button>
                        )}
                        {phase.kind === 'downloaded' && (
                            <button
                                type="button"
                                onClick={() => void handleInstall()}
                                data-android-update-install="true"
                                className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-amber-500/90 px-2 py-1 font-bold text-black transition-opacity hover:opacity-90"
                            >
                                <CheckCircle2 size={11} />
                                {t('options.androidUpdateInstall')}
                            </button>
                        )}
                        {phase.kind === 'failed' && (
                            <p className="inline-flex w-full items-start gap-1 opacity-70" style={{ color: 'var(--text-secondary)' }}>
                                <AlertCircle size={11} className="mt-[3px] shrink-0" />
                                <span>{t(failureKeyOf(phase.message))}</span>
                        </p>
                        )}
                    </div>
                )}
                <div className="flex flex-wrap items-center justify-center gap-1">
                    {apk && (isDownloading || phase.kind === 'downloaded' || phase.kind === 'failed') && (
                        <button
                            type="button"
                            onClick={() => void handleDownload()}
                            disabled={isDownloading}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 opacity-65 transition-colors hover:bg-white/10 hover:opacity-100 disabled:opacity-40"
                            style={{ color: 'var(--text-secondary)' }}
                        >
                            <RefreshCw size={11} />
                            {isDownloading ? t('options.androidUpdateDownloading') : t('options.androidUpdateDownload')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => handleOpen(release?.pageUrl ?? APP_UPDATE_RELEASES_PAGE)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 opacity-65 transition-colors hover:bg-white/10 hover:opacity-100"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        <ExternalLink size={11} />
                        {t('options.androidUpdateOpenPage')}
                    </button>
                </div>
            </div>

            {isAvailable && (
                <p className="max-w-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.androidUpdateInstallHint')}
                </p>
            )}

            {installNotice === 'permission-required' && (
                <p className="inline-flex max-w-sm items-start gap-1 text-amber-500/90">
                    <AlertCircle size={11} className="mt-[3px] shrink-0" />
                    <span>{t('options.androidUpdateInstallPermissionHint')}</span>
                </p>
            )}

            {result?.status === 'failed' && (
                <p className="inline-flex max-w-sm items-start gap-1 opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    <AlertCircle size={11} className="mt-[3px] shrink-0" />
                    <span>{t('options.androidUpdateFailedNotice')}</span>
                </p>
            )}

            {release?.notes && (
                <details className="w-full max-w-sm text-left">
                    <summary
                        className="cursor-pointer text-center opacity-60 hover:opacity-100"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        {t('options.androidUpdateNotes')}
                    </summary>
                    <pre
                        className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-white/[0.035] p-2 font-sans opacity-70"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        {release.notes}
                    </pre>
                </details>
            )}
        </div>
    );
};

export default AndroidUpdateCheck;
