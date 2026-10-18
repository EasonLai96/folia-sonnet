import { SPECTRUM_WORKLET_NAME, SPECTRUM_WORKLET_SOURCE } from './spectrumWorkletSource';

// src/services/spectrumTap.ts
// 播放页取频谱的**另一条路**：音频线程算、主线程只读。
//
// 原来那一条是每帧同步调 `analyser.getByteFrequencyData()`：这个调用要等音频线程把最近一次
// 渲染结果交出来，而输出缓冲越大（放音乐为了抗撕裂就得开大，见 usePlaybackAudioBridge 的
// AUDIO_OUTPUT_LATENCY_HINT_SEC）等得越久 —— 播放页整页掉帧就是这么来的，而且**所有**可视化
// 模式一起慢，因为卡的是取频谱这一步。壁纸叠层完全不卡，正因为它走原生的 Visualizer，压根
// 不经过 AudioContext —— 那是最有力的对照证据。
//
// 这里把算的那一步搬进 AudioWorklet：processor 在音频线程里做完 FFT 和平滑，把结果 post
// 出来；主线程只保存最新一份，rAF 读它的时候**不碰任何 Web Audio 方法**，一次都不等。于是
// 输出缓冲爱开多大开多大，撕裂和掉帧不再是一对矛盾。
//
// 走不通（没有 AudioWorklet / addModule 失败 / WebView 不给加载 Blob）就返回 false，调用方
// 照旧用 AnalyserNode —— 这条路是**加成**，不是依赖。

/** 音频线程交出来的一份频谱。读它不需要等任何东西。 */
export type SpectrumSnapshot = {
    /** 与 `getByteFrequencyData` 同格式的整条频谱。 */
    spectrum: Uint8Array;
    bass: number;
    lowMid: number;
    mid: number;
    vocal: number;
    treble: number;
    /** 这份数据到手的时间（`Date.now()`）。 */
    at: number;
};

type Tap = {
    latest: SpectrumSnapshot | null;
    dispose: () => void;
};

let active: Tap | null = null;

/** 最新一份频谱，没接上或还没到手就是 null。调用方拿不到就退回 AnalyserNode。 */
export const readLatestSpectrum = (): SpectrumSnapshot | null => active?.latest ?? null;

/** 这一路接上没有。只想问「有没有」而不是取数据时用它。 */
export const hasSpectrumTap = (): boolean => active !== null;

export const disposeSpectrumTap = (): void => {
    active?.dispose();
    active = null;
};

/**
 * 把频谱抽取挂到 `source` 上（图里挂在 analyser 之后，拿到的就是同一份信号）。
 *
 * 返回 false 表示这条路没走通 —— 已经把自己收拾干净，调用方照旧用 AnalyserNode 就行。
 */
export const createSpectrumTap = async (
    context: AudioContext,
    source: AudioNode,
    options?: { fftSize?: number; smoothingTimeConstant?: number; hop?: number },
): Promise<boolean> => {
    if (typeof AudioWorkletNode === 'undefined' || !context.audioWorklet) return false;

    let url: string | null = null;
    let node: AudioWorkletNode | null = null;
    let mute: GainNode | null = null;
    try {
        // Blob 而不是打包出来的文件：addModule 要的是加载时就能跑的脚本，走打包器那条路在
        // 安卓 WebView 上拿到的经常是没编译过的 URL。见 spectrumWorkletSource 的注释。
        url = URL.createObjectURL(new Blob([SPECTRUM_WORKLET_SOURCE], { type: 'application/javascript' }));
        await context.audioWorklet.addModule(url);

        node = new AudioWorkletNode(context, SPECTRUM_WORKLET_NAME, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: {
                fftSize: options?.fftSize ?? 2048,
                smoothingTimeConstant: options?.smoothingTimeConstant ?? 0.6,
                hop: options?.hop ?? 1024,
            },
        });
        // processor 本来就不写输出（静音），再串一个零增益是双保险：这一路只抽频谱。
        mute = context.createGain();
        mute.gain.value = 0;
        source.connect(node);
        node.connect(mute);
        mute.connect(context.destination);

        const tap: Tap = { latest: null, dispose: () => undefined };
        node.port.onmessage = (event: MessageEvent) => {
            const data = event.data as { spectrum?: ArrayBuffer; bands?: ArrayBuffer } | null;
            if (!data?.spectrum || !data.bands) return;
            const bands = new Float32Array(data.bands);
            tap.latest = {
                spectrum: new Uint8Array(data.spectrum),
                bass: bands[0] ?? 0,
                lowMid: bands[1] ?? 0,
                mid: bands[2] ?? 0,
                vocal: bands[3] ?? 0,
                treble: bands[4] ?? 0,
                at: Date.now(),
            };
        };
        tap.dispose = () => {
            try {
                node?.port.postMessage('stop');
            } catch {
                // 音频线程已经不在了。
            }
            node?.disconnect();
            mute?.disconnect();
            node = null;
            mute = null;
        };

        // 换歌 / 重建图时可能已经有上一个：先收拾旧的，别让两个 processor 一起跑。
        disposeSpectrumTap();
        active = tap;
        return true;
    } catch (error) {
        console.warn('[SpectrumTap] 音频线程取频谱这条路没走通，退回 AnalyserNode：', error);
        node?.disconnect();
        mute?.disconnect();
        return false;
    } finally {
        if (url) URL.revokeObjectURL(url);
    }
};
