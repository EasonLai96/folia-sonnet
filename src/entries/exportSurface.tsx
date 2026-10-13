import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motionValue, type MotionValue } from 'framer-motion';

/*
 * 这个 import 不能省，理由和壁纸那一层一样（见 src/entries/wallpaperSurface.tsx）：
 * 全局样式是 src/bootstrap.tsx 引的，而这是**另一个 HTML 入口**，不经过 bootstrap。
 * 少了它整个页面没有一条工具类生效，可视化会被卡在兜底尺寸上。
 */
import '../index.css';

import { getVisualizerRegistryEntry, hasVisualizerMode } from '../components/visualizer/registry';
import { applyVisualizerTuning } from '../components/visualizer/tuningRegistry';
import { DEFAULT_THEME } from '../services/baseThemes';
import {
    readExportRenderConfig,
    type ExportRenderConfig,
} from '../services/videoExport/exportConfig';
import { syncLyricFlatAttribute, useLyricFlatSettingsStore } from '../stores/useLyricFlatSettingsStore';
import type { AudioBands, Line, Theme, VisualizerMode } from '../types';
import { NO_LYRIC_LINES } from '../utils/lyrics/noLyricLines';

// src/entries/exportSurface.tsx
// 安卓「把歌词动画渲染成视频」用的**离屏渲染页**。
//
// 它和主播放页是两回事：主播放页上有播放条、系统栏、控制面板，抓那一屏等于录屏。
// 这一页只有可视化本身，时钟由导出程序一帧一帧往前推（合成时钟，不是真实播放），
// 所以录出来的是"渲染结果"而不是"屏幕上刚好在放的东西"。
//
// 桌面端那一套在 src/mods/export/modExportPage.tsx，思路一致（独立页面 + renderFrame），
// 区别只有两处：
//  · 配置从 localStorage 来（安卓没有 preload 可以注入，见 services/videoExport/exportConfig）；
//  · 这里要做一次 WebGL 探测 —— 原生那边是靠关掉硬件加速来离屏取帧的，
//    WebGL 在那条路上走 SwiftShader（CPU），能不能用不是必然的。
//
// 帧同步用的是**计数器**而不是 Promise：`evaluateJavascript` 对 Promise 的等待行为
// 在不同 WebView 版本上不保证一致，而"这一帧真的画完了"是整个导出正确性的前提。
// 所以 renderFrame 立刻返回，画完之后把 `window.__foliaExportFrameStamp` 推到
// index + 1，原生轮询这个值 —— 慢一点，但不会录到上一帧。

/** 首帧判定：内容出现后还要稳定存在多久。给懒加载的可视化一点时间。 */
const CONTENT_DWELL_MS = 400;

const STATIC_AUDIO_BANDS: AudioBands = {
    bass: motionValue(0),
    lowMid: motionValue(0),
    mid: motionValue(0),
    vocal: motionValue(0),
    treble: motionValue(0),
};

/** 找出 t 时刻所在的那一行：最后一个 [start, end) 包含 t 的。 */
const findActiveLineIndex = (lines: Line[], tSec: number): number => {
    let low = 0;
    let high = lines.length - 1;
    let candidate = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const line = lines[mid];
        if (!line) break;
        if (tSec < line.startTime) {
            high = mid - 1;
        } else if (tSec >= line.endTime) {
            low = mid + 1;
        } else {
            candidate = mid;
            high = mid - 1;
        }
    }
    if (candidate >= 0) return candidate;
    // 行未排序时的兜底：从后往前找第一个命中的。
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (line && tSec >= line.startTime && tSec < line.endTime) {
            return index;
        }
    }
    return -1;
};

/**
 * WebGL 探测。
 *
 * 原生取帧是关掉硬件加速后 `View.draw()`，这条路上 WebGL 走的是 SwiftShader（CPU）。
 * 多数机器能用，但不是必然 —— 建不出上下文的话，Pixi 那批模式画出来就是空的，
 * 原生那边据此决定是否降级到「可见窗口 + PixelCopy」。
 */
const probeWebgl = (): boolean => {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return false;
        // 建出来还不够：真的画一笔，确认不是个空壳上下文。
        const context = gl as WebGLRenderingContext;
        context.clearColor(0, 1, 0, 1);
        context.clear(context.COLOR_BUFFER_BIT);
        const pixel = new Uint8Array(4);
        context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
        return pixel[1] > 200;
    } catch {
        return false;
    }
};

const pinToNativeSize = (element: HTMLElement): { width: string; height: string } => {
    const params = new URLSearchParams(window.location.search);
    const width = Number(params.get('w'));
    const height = Number(params.get('h'));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return { width: '100%', height: '100%' };
    }
    document.documentElement.style.width = `${width}px`;
    document.documentElement.style.height = `${height}px`;
    document.body.style.width = `${width}px`;
    document.body.style.height = `${height}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    return { width: `${width}px`, height: `${height}px` };
};

/**
 * 把舞台这一级钉死在导出尺寸上，并压掉全局样式表那条 body 底色。
 *
 * 尺寸不能用 100vw/100vh：这一页是被原生手动 measure/layout 到导出尺寸的，
 * 布局视口和它不一定一致 —— 用视口算出来的话画布就定死在错误的尺寸上。
 *
 * 底色必须压掉：全局样式里有一条 `body { background-color: #09090b; }`（给 App 本体用的），
 * 这一页引了同一份样式表，不压掉的话 alpha 永远出不来。
 */
const forceTransparentBackdrop = (): void => {
    const style = document.createElement('style');
    style.textContent = `
        html, body, #export-root {
            background: transparent !important;
            background-color: transparent !important;
        }
    `;
    document.head.appendChild(style);
};

/**
 * 把「外壳」这一条祖先链撑满。
 *
 * 和壁纸那一层同一个坑（见 src/entries/wallpaperSurface.tsx 的 forceShellToFill）：
 * 可视化的外壳是 `w-full h-full`（百分比高度），中间只要有一环是 auto 高度就塌成 0，
 * 而画布是从宿主的 clientHeight 量的 —— 量到 0 会落到它内部的兜底下限（240），
 * 录出来就只有顶上一条。
 *
 * 只修**确实塌了**的那一环（高度为 0）：某些模式有意给容器设了特定尺寸，
 * 一刀切会误伤（壁纸那边试过，齿轮被拉伸、歌词消失）。
 */
const forceCanvasChainToFill = (): void => {
    const stage = document.getElementById('export-stage');
    if (!stage) return;
    const canvas = stage.querySelector('canvas');
    if (!canvas) return;
    let element: HTMLElement | null = canvas.parentElement;
    while (element && element !== stage) {
        if (element.clientHeight === 0) {
            element.style.height = '100%';
            element.style.minHeight = '100%';
        }
        element = element.parentElement;
    }
};

// 「歌词改为纯色扁平」在这个页面上同样只认**本页** <html> 上的 data-lyric-flat
// （CSS 在 index.css 里，canvas 侧读 utils/lyricFlat，两边只看这个属性）。
// 它是另一个 document，主窗口那份属性过不来 —— 不在这里挂一份，导出的片和 App 里不一致。
syncLyricFlatAttribute(useLyricFlatSettingsStore.getState().flatLyrics);
useLyricFlatSettingsStore.subscribe(state => syncLyricFlatAttribute(state.flatLyrics));

type ExportSurfaceProps = {
    /** 原生经 URL 传进来的导出尺寸（CSS 像素）。 */
    size: { width: string; height: string };
};

const ExportSurface: React.FC<ExportSurfaceProps> = ({ size }) => {
    const [config, setConfig] = useState<ExportRenderConfig | null>(null);
    const [currentLineIndex, setCurrentLineIndex] = useState(-1);
    const currentTimeRef = useRef<MotionValue<number>>(motionValue(0));
    const audioPowerRef = useRef<MotionValue<number>>(motionValue(0));
    const linesRef = useRef<Line[]>([]);

    const applyLineIndex = useCallback((tSec: number) => {
        const nextIndex = findActiveLineIndex(linesRef.current, tSec);
        setCurrentLineIndex(previous => (previous === nextIndex ? previous : nextIndex));
    }, []);

    /**
     * 把画面推进到第 t 秒。
     *
     * 立刻返回，不等 Promise —— 原生那边是靠 `window.__foliaExportFrameStamp`
     * 判断"画完了没有"的（见文件头）。等两帧：一帧不够 React 把新的 currentLineIndex
     * 提交到 DOM（并发渲染下 setState 是异步调度的），少等一帧就会稳定地录到上一帧。
     */
    const renderFrame = useCallback((tSec: number, index: number) => {
        currentTimeRef.current.set(tSec);
        applyLineIndex(tSec);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            (window as unknown as Record<string, unknown>).__foliaExportFrameStamp = index + 1;
        }));
    }, [applyLineIndex]);

    useEffect(() => {
        const next = readExportRenderConfig();
        linesRef.current = next?.lyricData?.lines ?? [];
        setConfig(next);
        applyLineIndex(Number(next?.startSec ?? 0));

        (window as unknown as Record<string, unknown>).__foliaExportFrameStamp = 0;
        (window as unknown as Record<string, unknown>).__foliaExportWebglOk = probeWebgl();
        (window as unknown as Record<string, unknown>).__foliaExport = {
            renderFrame: (tSec: number, index: number) => renderFrame(tSec, index),
        };
        return () => {
            delete (window as unknown as Record<string, unknown>).__foliaExport;
        };
    }, [applyLineIndex, renderFrame]);

    /*
     * 「内容真的画出来了」的标记。
     *
     * 原生等它才开始取第一帧：可视化是懒加载的（chunk 下载 + Pixi/WebGL 初始化），
     * 从"页面就绪"到"真的画出东西"中间有一段空窗，不等的话开头几秒录下来是空白。
     */
    useEffect(() => {
        if (!config) return undefined;
        let cancelled = false;
        let seenAt = 0;
        const deadline = performance.now() + 6000;
        const mark = () => {
            if (cancelled) return;
            (window as unknown as Record<string, unknown>).__foliaExportPainted = true;
        };
        const look = () => {
            if (cancelled) return;
            const stage = document.getElementById('export-stage');
            const canvas = stage?.querySelector('canvas') ?? null;
            const mounted = Boolean(canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0)
                || Boolean(stage && stage.firstElementChild
                    && stage.getBoundingClientRect().height > 0);
            const now = performance.now();
            if (mounted) {
                forceCanvasChainToFill();
                if (seenAt === 0) seenAt = now;
                if (now - seenAt >= CONTENT_DWELL_MS) {
                    mark();
                    return;
                }
            } else if (now > deadline) {
                // 到点了还没等到：先放行，不能为了一个信号一直卡着。
                mark();
                return;
            }
            window.setTimeout(look, 80);
        };
        look();
        return () => {
            cancelled = true;
        };
    }, [config]);

    const mode = config?.visualizerMode ?? 'classic';
    const effectiveMode: VisualizerMode = hasVisualizerMode(mode) ? mode : 'classic';
    const entry = getVisualizerRegistryEntry(effectiveMode);
    const lines = config?.lyricData?.lines ?? NO_LYRIC_LINES;
    const theme = config?.theme ?? DEFAULT_THEME;

    const resolvedProps = applyVisualizerTuning(effectiveMode, {
        currentTime: currentTimeRef.current,
        currentLineIndex,
        lines,
        theme,
        audioPower: audioPowerRef.current,
        audioBands: STATIC_AUDIO_BANDS,
        showText: true,
        songTitle: config?.songMeta?.title ?? null,
        songArtist: config?.songMeta?.artist ?? null,
        paused: false,
        visualizerOpacity: 1,
        background: config?.backgroundMode === 'theme'
            ? undefined
            : { transparent: true, common: { disableGeometricBackground: true, disableVignette: true } },
    }, config?.visualizerTunings ?? undefined);

    const containerBackground = config?.backgroundMode === 'theme'
        ? (theme.backgroundColor ?? '#09090b')
        : 'transparent';

    return (
        <div
            id="export-stage"
            data-folia-lyric-surface="export"
            style={{
                width: size.width,
                height: size.height,
                minHeight: size.height,
                overflow: 'hidden',
                backgroundColor: containerBackground,
                // 这两个变量是 App 写在根上的（见 App.tsx 的 appStyle），这里是另一个 document，
                // 拿不到 —— 不补的话扁平歌词那套规则会填到 initial（黑），歌词糊成一团。
                ['--text-primary' as string]: theme.primaryColor,
                ['--text-secondary' as string]: theme.secondaryColor,
            }}
        >
            {config ? (
                <Suspense fallback={null}>{entry.render(resolvedProps)}</Suspense>
            ) : (
                <div />
            )}
        </div>
    );
};

const rootElement = document.getElementById('export-root');
if (rootElement) {
    forceTransparentBackdrop();
    const size = pinToNativeSize(rootElement);
    createRoot(rootElement).render(<ExportSurface size={size} />);
    /*
     * 字体是异步加载的，画布往往比它先出现 —— 不等的话前几帧会拿默认字体画一遍，
     * 录出来开头一段字形不对。这里等字体就绪（最多 1.5 秒）再告诉原生"可以开始了"。
     */
    const fonts = document.fonts;
    const markReady = () => {
        (window as unknown as Record<string, unknown>).__foliaExportReady = true;
    };
    if (fonts && fonts.ready) {
        Promise.race([
            fonts.ready,
            new Promise<void>(resolve => window.setTimeout(resolve, 1500)),
        ]).then(markReady);
    } else {
        markReady();
    }
}
