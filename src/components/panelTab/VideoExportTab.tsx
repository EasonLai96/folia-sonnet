import React, { useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Film, X } from 'lucide-react';
import { PlayerState } from '../../types';
import type { SongResult, Theme, VisualizerMode } from '../../types';
import { selectDisplayLyrics, usePlaybackStore } from '../../stores/usePlaybackStore';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { setIsPanelOpen } from '../../stores/useAppViewStore';
import { collectVisualizerTunings } from '../../components/visualizer/tuningRegistry';
import {
    beginVideoExport,
    cancelActiveExport,
    dismissVideoExportResult,
    getVideoExportSnapshot,
    getVideoExportVersion,
    subscribeVideoExport,
} from '../../services/videoExport/controller';
import type { ExportRenderConfig } from '../../services/videoExport/exportConfig';
import { isVideoExportAvailable } from '../../platform/foliaExport';

// src/components/panelTab/VideoExportTab.tsx
// 「把歌词动画渲染成视频」这一页。
//
// 它替代的是桌面端那个模组（mods/sample-transparent-mov-export）：模组只在 Electron
// 上加载，安卓这边 `src/mods/ipc.ts` 没有 bridge，`reloadMods()` 返回空数组 ——
// 所以这个功能在手机上一直是不存在的，不是没入口，是压根没有实现。
//
// 录的是**渲染结果**，不是录屏：原生会开一个离屏渲染页（export.html），那一页上只有
// 可视化本身，时钟由导出程序一帧一帧往前推（合成时钟，不是真实播放）。抓主窗口是不行的
// —— 那一屏上有播放条、系统栏、控制面板，抓下来就是录屏。
//
// 两个和桌面端不一样的地方，界面上必须说清楚：
//  · **导出的是不透明的 MP4**。安卓 MediaCodec 的 VP8/VP9/AV1 都不支持 alpha 通道，
//    想保住透明只能往 APK 里塞第三方编码器 —— 不划算。
//  · **比实时慢很多**。一帧要推一次时间 + 等两帧 rAF + 画一遍，1080p 上一帧几十毫秒
//    很常见，30 秒的片段实际要跑好几分钟。所以默认只给 30 秒。

interface VideoExportTabProps {
    isDaylight: boolean;
    /** 当前主题。渲染页是另一个 WebView，拿不到 App 里的主题，只能随配置送过去。 */
    theme: Theme;
    visualizerMode: VisualizerMode;
    currentSong: SongResult | null;
    /**
     * 导出前要先把播放停住。
     *
     * 画面是由导出程序按帧推的，而播放时钟会继续往前走 —— 不停的话两边的时间会打架
     * （进度条和状态栏歌词照常跑，而片子里的时间是另一条）。
     */
    onTogglePlay?: () => void;
}

/** 时长档位（秒）。整首按当前歌曲算，并夹在原生那条上限里。 */
const CLIP_SECONDS = [15, 30, 60] as const;
const MAX_CLIP_SECONDS = 900;

type Resolution = 720 | 1080;

const VideoExportTab: React.FC<VideoExportTabProps> = (
    { isDaylight, theme, visualizerMode, currentSong, onTogglePlay },
) => {
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
         * 面板要收起来：它浮在画面之上，开着会挡住正在渲染的那一屏（降级那条路抓的是
         * 整个窗口）。驱动本身挂在 App 上（useVideoExportBridge），面板关掉不影响它在跑。
         */
        setIsPanelOpen(false);
        if (playerState === PlayerState.PLAYING) {
            onTogglePlay?.();
        }
        // 输出按窗口比例：硬编成固定宽高会把画面拉扁。
        const longEdge = resolution;
        const ratio = window.innerWidth / Math.max(1, window.innerHeight);
        const width = ratio >= 1 ? longEdge : Math.round(longEdge * ratio);
        const height = ratio >= 1 ? Math.round(longEdge / ratio) : longEdge;

        /*
         * 渲染页是另一个 WebView，和主应用之间没有桥 —— 「拍什么」只能经 localStorage
         * 送过去（见 services/videoExport/exportConfig）。这里读的是**点这一下**的快照，
         * 不订阅：这一页不需要因为歌词换了一份就重渲染。
         */
        const lyrics = selectDisplayLyrics(usePlaybackStore.getState());
        const settings = useVisualizerSettingsStore.getState();
        const config: ExportRenderConfig = {
            lyricData: lyrics ? { lines: lyrics.lines } : null,
            visualizerMode,
            visualizerTunings: collectVisualizerTunings(settings as unknown as Record<string, unknown>),
            theme,
            songMeta: {
                title: currentSong?.name ?? undefined,
                artist: currentSong?.artists?.map(item => item.name).join(', ') || undefined,
            },
            startSec: 0,
            // 不透明导出：让渲染页自己铺主题底色，别指望后面再抠。
            backgroundMode: 'theme',
            width,
            height,
        };

        void beginVideoExport({
            width,
            height,
            fps,
            bitrateMbps: resolution >= 1080 ? 12 : 8,
            totalFrames,
            startSec: 0,
            backgroundColor: 0xFF000000 | 0,
        }, config);
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
