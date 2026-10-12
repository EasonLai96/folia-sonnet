import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  APP_UPDATE_RELEASES_PAGE,
  checkForAppUpdate,
  type AppUpdateCheckResult,
} from '../../../services/appUpdate';
import { openExternalUrl } from '../../../utils/openExternalUrl';

// src/components/modal/settings/AndroidUpdateCheck.tsx
// 安卓端的「检查更新」。
//
// 桌面端那套更新 UI 读的是 electron-updater 的状态（window.electron.getUpdateStatus），
// 在 WebView 里恒为空，所以这里单独做一条：
//   查 GitHub Releases 的最新正式版 → 比版本号 → 把下载地址交给系统浏览器。
//
// 只做「查 + 给下载入口」，不做静默安装 —— Android 不允许应用自己装更新包，
// 非 Play 分发必须落到系统安装器并让用户点确认。想省掉这一步得走 Play 的
// In-App Updates（要求包从 Play 分发），那又是另一条路。
//
// 挂载点：设置的帮助页底部版本区（桌面端的更新提示也在那里）。

/** 把字节数写成人话，安装包尺寸没必要精确到个位。 */
const formatSize = (bytes: number): string => (
  bytes > 0 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : ''
);

const AndroidUpdateCheck: React.FC = () => {
  const { t } = useTranslation();
  const [result, setResult] = useState<AppUpdateCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  // 关掉面板时把在飞的请求掐掉：检查更新是个 12 秒超时的网络请求，
  // 组件已经卸载还往回 setState 会白跑一趟。
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleCheck = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsChecking(true);
    try {
      const next = await checkForAppUpdate(controller.signal);
      if (!controller.signal.aborted) setResult(next);
    } catch {
      // 只有主动取消会走到这里（其余失败已在服务里翻成 result），什么都不用做。
    } finally {
      if (!controller.signal.aborted) setIsChecking(false);
    }
  }, []);

  const handleOpen = useCallback((url: string) => {
    void openExternalUrl(url).catch(() => {
      // 打不开外链不算功能失败：地址就在上面，用户自己复制也行。
    });
  }, []);

  const isAvailable = result?.status === 'update-available';
  const release = result && result.status !== 'failed' ? result.release : null;
  const apk = isAvailable ? result.release.apk : null;

  const statusText = (() => {
    if (isChecking) return t('options.updateChecking');
    if (!result) return null;
    if (result.status === 'update-available') return t('options.newVersionFound', { version: result.release.version });
    if (result.status === 'up-to-date') return t('options.androidUpdateLatest', { version: result.currentVersion });
    if (result.message === 'no-release') return t('options.androidUpdateFailedNoRelease');
    if (result.message === 'timeout') return t('options.androidUpdateFailedTimeout');
    return t('options.updateCheckFailed');
  })();

  return (
    <div className="mt-1 flex max-w-full flex-col items-center gap-1.5 font-sans text-[11px] leading-snug">
      <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
        {statusText && (
          <span
            className={isAvailable ? 'font-semibold text-amber-500' : 'opacity-60'}
            style={isAvailable ? undefined : { color: 'var(--text-secondary)' }}
            data-android-update-status={result?.status ?? 'checking'}
          >
            {statusText}
          </span>
        )}
        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={isChecking}
          data-android-update-check="true"
          className="inline-flex items-center gap-1 opacity-65 transition-colors hover:opacity-100 disabled:opacity-40"
          style={{ color: 'var(--text-secondary)' }}
        >
          {isChecking ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          {t('options.androidUpdateCheck')}
        </button>
      </div>

      {/* 下载入口与发布页：拿不到 Release 时（还在查 / 查失败）也给手动入口，
          否则网络对不上 GitHub 的那天连「打开发布页」都点不到。 */}
      <div className="flex flex-wrap items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.035] p-1">
        {apk && (
          <button
            type="button"
            onClick={() => handleOpen(apk.downloadUrl)}
            data-android-update-download="true"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-bold opacity-90 transition-colors hover:bg-white/10 hover:opacity-100"
          >
            <Download size={11} />
            {t('options.androidUpdateDownload')}
            {apk.sizeBytes > 0 && <span className="font-normal opacity-60">{formatSize(apk.sizeBytes)}</span>}
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

      {isAvailable && (
        <p className="max-w-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>
          {t('options.androidUpdateInstallHint')}
        </p>
      )}

      {result?.status === 'failed' && (
        <p className="inline-flex max-w-sm items-start gap-1 opacity-60" style={{ color: 'var(--text-secondary)' }}>
          <AlertCircle size={11} className="mt-[3px] shrink-0" />
          <span>{t('options.androidUpdateGithubNotice')}</span>
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
