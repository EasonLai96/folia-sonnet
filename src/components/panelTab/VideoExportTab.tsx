import React, { useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Film, X } from 'lucide-react';
import { PlayerState } from '../../types';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { setIsPanelOpen } from '../../stores/useAppViewStore';
import {
    beginVideoExport,
    cancelActiveExport,
    dismissVideoExportResult,
    getVideoExportSnapshot,
    getVideoExportVersion,
    subscribeVideoExport,
} from '../../services/videoExport/controller';
import { isVideoExportAvailable } from '../../platform/foliaExport';

// src/components/panelTab/VideoExportTab.tsx
// 「把歌词动画录成视频」这一页。
//
// 它替代的是桌面端那个模组（mods/sample-transparent-mov-export）：模组只在 Electron
// 上加载，安卓这边 `src/mods/ipc.ts` 没有 bridge，`reloadMods()` 返回空数组 ——
// 所以这个功能在手机上一直是不存在的，不是没入口，是压根没有实现。
//
// 两个和桌面端不一样的地方，界面上必须说清楚：
//  · **导出的是不透明的 MP4**。安卓 MediaCodec 的 VP8/VP9/AV1 都不支持 alpha 通道，
//    想保住透明只能往 APK 里塞第三方编码器 —— 不划算。
//  · **比实时慢很多**。一帧一次 PixelCopy（抓屏），1080p 上一帧几十毫秒很常见，
//    30 秒的片段实际要跑好几分钟。所以默认只给 30 秒。

interface VideoExportTabProps {
    isDaylight: boolean;
    /** 导出前要先把播放停住：画面得由导出循环推，播放时钟会把它拽回去。 */
    onTogglePlay?: () => void;
}

/** 时长档位（秒）。整首按当前歌曲算，并夹在原生那条上限里。 */
const CLIP_SECONDS = [15, 30, 60] as const;
const MAX_CLIP_SECONDS = 900;

type Resolution = 720 | 1080;

const VideoExportTab: React.FC<VideoExportTabProps> = ({ isDaylight, onTogglePlay }) => {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeVideoExport, getVideoExportVersion);
    const snapshot = getVideoExportSnapshot();
    const playerState = usePlaybackStore(state => state.playerState);
    const duration = usePlaybackStore(state => state.duration);

    const [clipSeconds, setClipSeconds] = React.useState<number>(30);
    const [resolution, setResolution] = React.useState<Resolution>(720);
    const [fps, setFps] = React.useState(30);

    const available = isVideoExportAvailable();
    const running = snapshot.status === 'running';

    const effectiveSeconds = useMemo(() => {
        if (clipSeconds > 0) return clipSeconds;
        // 整首：没有时长就退回 30 秒，别导出个空文件。
        return duration > 0 ? Math.min(duration, MAX_CLIP_SECONDS) : 30;
    }, [clipSeconds, duration]);

    const totalFrames = Math.max(1, Math.round(effectiveSeconds * fps));

    const cardClass = isDaylight ? 'bg-black/[0.04] border-black/10' : 'bg-white/5 border-white/10';
    const rowDivider = isDaylight ? 'border-black/10' : 'border-white/10';
    const muted = isDaylight ? 'text-black/55' : 'text-white/55';
    const chipClass = (active: boolean) => (
        `rounded-lg border px-2.5 py-1 text-xs transition-colors ${
            active
                ? 'border-[color:var(--accent-color,#8b5cf6)] text-[color:var(--accent-color,#8b5cf6)]'
                : (isDaylight ? 'border-black/10 text-black/70' : 'border-white/10 text-white/70')
        }`
    );

    const handleStart = () => {
        /*
         * 画面必须独占了屏幕才能让 PixelCopy 抓到干净的一帧，所以这里把面板收起来。
         * 驱动本身挂在 App 上（useVideoExportBridge），面板关掉不影响它在跑。
         */
        setIsPanelOpen(false);
        if (playerState === PlayerState.PLAYING) {
            onTogglePlay?.();
        }
        // 输出按窗口比例：抓帧拿到的是窗口原始尺寸，硬编成固定宽高会把画面拉扁。
        const longEdge = resolution;
        const ratio = window.innerWidth / Math.max(1, window.innerHeight);
        const width = ratio >= 1 ? longEdge : Math.round(longEdge * ratio);
        const height = ratio >= 1 ? Math.round(longEdge / ratio) : longEdge;
        void beginVideoExport({
            width,
            height,
            fps,
            bitrateMbps: resolution >= 1080 ? 12 : 8,
            totalFrames,
            startSec: 0,
            backgroundColor: 0xFF000000 | 0,
        });
    };

    const optionRow = (label: string, children: React.ReactNode) => (
        <div className={`flex items-center justify-between gap-3 border-b px-3 py-2.5 last:border-b-0 ${rowDivider}`}>
            <span className="text-sm font-medium">{label}</span>
            <span className="flex flex-wrap justify-end gap-1.5">{children}</span>
        </div>
    );

    return (
        <div className="space-y-3">
            <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
                <div className={`flex items-center gap-2 px-3 py-2.5 border-b ${rowDivider}`}>
                    <Film size={14} className="opacity-60" />
                    <span className="text-sm font-medium">{t('panel.videoExport')}</span>
                </div>

                {!available ? (
                    <div className={`px-3 py-2.5 text-xs leading-relaxed ${muted}`}>
                        {t('videoExport.desktopOnly')}
                    </div>
                ) : snapshot.status === 'unsupported' ? (
                    <div className={`px-3 py-2.5 text-xs leading-relaxed ${muted}`}>
                        {snapshot.message || t('videoExport.unsupported')}
                    </div>
                ) : running ? (
                    <div className="space-y-2 px-3 py-2.5">
                        <div className="flex items-baseline justify-between text-xs">
                            <span>{t('videoExport.running')}</span>
                            <span className={`tabular-nums ${muted}`}>
                                {snapshot.frame} / {snapshot.total || totalFrames}
                            </span>
                        </div>
                        <div className={`h-1.5 overflow-hidden rounded-full ${isDaylight ? 'bg-black/10' : 'bg-white/10'}`}>
                            <div
                                className="h-full rounded-full bg-[color:var(--accent-color,#8b5cf6)] transition-[width] duration-200"
                                style={{
                                    width: `${Math.min(100, (snapshot.frame / Math.max(1, snapshot.total || totalFrames)) * 100)}%`,
                                }}
                            />
                        </div>
                        <div className={`text-xs leading-relaxed ${muted}`}>{t('videoExport.runningHint')}</div>
                    </div>
                ) : snapshot.status === 'done' ? (
                    <div className="space-y-1 px-3 py-2.5 text-xs leading-relaxed">
                        <div>{t('videoExport.done')}</div>
                        {snapshot.path && <div className={`break-all ${muted}`}>{snapshot.path}</div>}
                    </div>
                ) : snapshot.status === 'cancelled' ? (
                    <div className={`px-3 py-2.5 text-xs leading-relaxed ${muted}`}>{t('videoExport.cancelled')}</div>
                ) : snapshot.status === 'error' ? (
                    <div className={`px-3 py-2.5 text-xs leading-relaxed ${muted}`}>
                        {snapshot.message || t('videoExport.failed')}
                    </div>
                ) : (
                    <div className={`px-3 py-2.5 text-xs leading-relaxed ${muted}`}>{t('videoExport.intro')}</div>
                )}
            </div>

            {available && snapshot.status !== 'unsupported' && (
                <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
                    {optionRow(t('videoExport.clipLength'), (
                        <>
                            {CLIP_SECONDS.map(seconds => (
                                <button
                                    key={seconds}
                                    type="button"
                                    disabled={running}
                                    onClick={() => setClipSeconds(seconds)}
                                    className={chipClass(clipSeconds === seconds)}
                                >
                                    {seconds}s
                                </button>
                            ))}
                            <button
                                type="button"
                                disabled={running}
                                onClick={() => setClipSeconds(0)}
                                className={chipClass(clipSeconds === 0)}
                            >
                                {t('videoExport.wholeSong')}
                            </button>
                        </>
                    ))}
                    {optionRow(t('videoExport.quality'), (
                        <>
                            {([720, 1080] as Resolution[]).map(value => (
                                <button
                                    key={value}
                                    type="button"
                                    disabled={running}
                                    onClick={() => setResolution(value)}
                                    className={chipClass(resolution === value)}
                                >
                                    {value}p
                                </button>
                            ))}
                        </>
                    ))}
                    {optionRow(t('videoExport.frameRate'), (
                        <>
                            {([24, 30, 60] as number[]).map(value => (
                                <button
                                    key={value}
                                    type="button"
                                    disabled={running}
                                    onClick={() => setFps(value)}
                                    className={chipClass(fps === value)}
                                >
                                    {value}
                                </button>
                            ))}
                        </>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                {running ? (
                    <button
                        type="button"
                        onClick={() => void cancelActiveExport()}
                        className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium"
                        style={{ borderColor: 'var(--text-secondary)', color: 'var(--text-primary)' }}
                    >
                        <X size={12} />
                        {t('videoExport.cancel')}
                    </button>
                ) : (
                    <button
                        type="button"
                        disabled={!available}
                        onClick={handleStart}
                        className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium"
                        style={{ borderColor: 'var(--text-secondary)', color: 'var(--text-primary)' }}
                    >
                        <Film size={12} />
                        {t('videoExport.start')}
                    </button>
                )}
                {snapshot.status === 'done' || snapshot.status === 'error' || snapshot.status === 'cancelled' ? (
                    <button
                        type="button"
                        onClick={dismissVideoExportResult}
                        className="rounded-lg border px-3 py-1.5 text-xs font-medium"
                        style={{ borderColor: 'var(--text-secondary)', color: 'var(--text-primary)' }}
                    >
                        {t('videoExport.dismiss')}
                    </button>
                ) : null}
            </div>

            <div className={`text-xs leading-relaxed ${muted}`}>{t('videoExport.notice')}</div>
        </div>
    );
};

export default VideoExportTab;
