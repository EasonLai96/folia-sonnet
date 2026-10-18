import { noteSpectrumFeedMode, noteSpectrumSource } from '../utils/mediaDiagnostics';
import { SPECTRUM_WORKLET_NAME, SPECTRUM_WORKLET_SOURCE } from './spectrumWorkletSource';

// src/services/spectrumTap.ts
// 播放页取频谱的**另一条路**：音频线程算、主线程只读。
//
// 原来那一条是每帧同步调 `analyser.getByteFrequencyData()`：它的开销是**在主线程上现算一遍
// FFT**（外加一次与音频线程互踢的锁），一帧一次、一秒六十次，播放页整页掉帧就是这么来的，
// 而且**所有**可视化模式一起慢 —— 卡的是取频谱这一步，不是某个模式的绘制。
//
// ⚠️ 一度以为「输出缓冲开得越大，那一次等得越久」（见 usePlaybackAudioBridge 的注释）：那条
// 因果链是错的，缓冲大小并不进这个开销。别照着那条旧结论去调 latencyHint。
//
// 这里把算的那一步搬进 AudioWorklet：processor 在音频线程里做完 FFT 和平滑，把结果 post
// 出来；主线程只保存最新一份，rAF 读它的时候**不碰任何 Web Audio 方法**，一次都不等。于是
// 输出缓冲爱开多大开多大，撕裂和掉帧不再是一对矛盾。
//
// 走不通（没有 AudioWorklet / addModule 失败 / WebView 不给加载 Blob）就返回 false，调用方
// 照旧用 AnalyserNode —— 这条路是**加成**，不是依赖。

/**
 * `addModule` 的最长等待。
 *
 * 它的 Promise 有可能**既不 resolve 也不 reject**（挂在还没跑起来的 context 上就是那样），
 * 那就既没有警告也没有 tap —— 取频谱一路落在同步兜底上，而日志上什么都看不出来。
 * 规定一个上限，过了就当这条路走不通，把原因写进诊断。
 */
const ADD_MODULE_TIMEOUT_MS = 4000;

const addModuleWithTimeout = async (context: AudioContext, url: string): Promise<void> => {
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(
            () => reject(new Error(`addModule 超过 ${ADD_MODULE_TIMEOUT_MS}ms 没有完成`)),
            ADD_MODULE_TIMEOUT_MS,
        );
    });
    try {
        await Promise.race([context.audioWorklet.addModule(url), timeout]);
    } finally {
        if (timer !== undefined) window.clearTimeout(timer);
    }
};

/**
 * 播放页每帧要不要取频谱 —— 排查开关（2026-10-18 加）。
 *
 * 三档不是三选一的配置，是一次二分排查的三步：
 *
 *  · `off` —— 一个字都不写。MotionValue 不更新 → 订阅它的可视化这一帧**连重画都不会发生**。
 *    这一档减掉的是「采集 + 渲染」一整条。
 *  · `synthetic` —— 每帧写一个与声音无关的呼吸。**渲染负载照旧，只抽掉采集**：MotionValue
 *    的 `set()` 是**无条件**通知订阅者的（framer-motion 的 `updateAndNotify` 不看值变没变），
 *    所以写假值照样驱动可视化每帧重画。这一档专门用来回答「贵的是取频谱，还是画」。
 *  · `on` —— 真频谱。
 *
 * 读法：`off` 不卡而 `synthetic` 卡 → 采集那一步贵；两档都不卡 → 频谱无辜，往渲染以外找；
 * `off` 还卡 → 频谱这条链路整体无份。
 *
 * 2026-10-18 用它实测过：`off` 之下播放页照旧卡 → **取频谱不是掉帧的成因**，这一档的活
 * 干完了。默认值已改回 `on`。开关留着是因为下次还要二分（比如怀疑歌词的那一侧时，
 * 关掉频谱能立刻把变量摘干净）；真不需要了就直接删掉，别留一个默认 `off` 的开关在仓库里。
 */
export type SpectrumFeedMode = 'on' | 'synthetic' | 'off';

const SPECTRUM_FEED_STORAGE_KEY = 'folia_spectrum_feed';
const SPECTRUM_FEED_DEFAULT: SpectrumFeedMode = 'on';

const readSpectrumFeedMode = (): SpectrumFeedMode => {
    if (typeof window === 'undefined') return SPECTRUM_FEED_DEFAULT;
    const raw = window.localStorage.getItem(SPECTRUM_FEED_STORAGE_KEY);
    if (raw === 'on' || raw === 'synthetic' || raw === 'off') return raw;
    return SPECTRUM_FEED_DEFAULT;
};

/**
 * 每帧都要问，别每帧去读 localStorage：模块加载时定一次。
 *
 * `latencyHint` 那个 knoh 也一样 —— 改完**重启 App** 才生效。
 */
let spectrumFeedMode: SpectrumFeedMode = readSpectrumFeedMode();

export const getSpectrumFeedMode = (): SpectrumFeedMode => spectrumFeedMode;

/**
 * `synthetic` 写给 `spectrum` 的那一份。模块级、原地改写：每帧 `new Uint8Array(1024)` 本身
 * 就是分配开销，而这一档要模拟的恰恰是「渲染照旧、只抽掉采集」—— 别把要测的东西一起减掉。
 */
const SYNTHETIC_SPECTRUM = new Uint8Array(1024);

/** `synthetic` 那档每帧写进去的频谱。返回的是同一个数组，调用方别持有。 */
export const fillSyntheticSpectrum = (level: number): Uint8Array => {
    SYNTHETIC_SPECTRUM.fill(level);
    return SYNTHETIC_SPECTRUM;
};

const installSpectrumFeedKnob = (): void => {
    if (typeof window === 'undefined') return;
    (window as Window & typeof globalThis & {
        __foliaSetSpectrumFeed?: (mode: SpectrumFeedMode) => SpectrumFeedMode;
    }).__foliaSetSpectrumFeed = (mode: SpectrumFeedMode) => {
        if (mode !== 'on' && mode !== 'synthetic' && mode !== 'off') {
            console.warn(`[SpectrumFeed] 不认的档位：${String(mode)}（只认 on / synthetic / off）`);
            return spectrumFeedMode;
        }
        spectrumFeedMode = mode;
        window.localStorage.setItem(SPECTRUM_FEED_STORAGE_KEY, mode);
        noteSpectrumFeedMode(mode);
        console.warn(
            `[SpectrumFeed] 频谱读取改成 ${mode}${mode === 'off' ? '（可视化会静止，这是预期）' : ''}；下次启动沿用这个值`,
        );
        return mode;
    };
};
installSpectrumFeedKnob();
noteSpectrumFeedMode(spectrumFeedMode);
if (spectrumFeedMode !== 'on') {
    console.warn(
        `[SpectrumFeed] 频谱读取当前是 ${spectrumFeedMode}（排查用），可视化不会跟随声音。`
        + '恢复：__foliaSetSpectrumFeed(\'on\')',
    );
}

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
    // 换歌 / 重建图会走到这里：新的那条还没接上，先退回"还不知道"，别把上一首的结果留着。
    noteSpectrumSource('unknown');
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
    if (typeof AudioWorkletNode === 'undefined' || !context.audioWorklet) {
        noteSpectrumSource('analyser', '这台机器上没有 AudioWorklet');
        // 这一条以前只写诊断不进日志，界面没开开发者选项就完全看不见 —— 而它恰恰是
        // 「取频谱一直在等音频线程」的另一半原因，必须留痕。
        console.warn('[SpectrumTap] 这台机器上没有 AudioWorklet，退回 AnalyserNode');
        return false;
    }

    let url: string | null = null;
    let node: AudioWorkletNode | null = null;
    let mute: GainNode | null = null;
    try {
        // Blob 而不是打包出来的文件：addModule 要的是加载时就能跑的脚本，走打包器那条路在
        // 安卓 WebView 上拿到的经常是没编译过的 URL。见 spectrumWorkletSource 的注释。
        url = URL.createObjectURL(new Blob([SPECTRUM_WORKLET_SOURCE], { type: 'application/javascript' }));
        await addModuleWithTimeout(context, url);

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
        noteSpectrumSource('worklet');
        /*
         * 留一条日志：这条路只有**失败**时才会出声（下面那个 catch），成功是静默的 ——
         * 于是翻日志的人分不清「接上了」和「addModule 的 Promise 卡在 suspended 的
         * context 上、既没成也没败」。后者正是播放页掉帧的样子。
         */
        console.info('[SpectrumTap] 频谱由音频线程抽，主线程不再等音频线程');
        return true;
    } catch (error) {
        // 记进诊断再 warn：这一条决定了播放页是不是会掉帧，光靠日志看不出来。
        noteSpectrumSource('analyser', error);
        console.warn('[SpectrumTap] 音频线程取频谱这条路没走通，退回 AnalyserNode：', error);
        node?.disconnect();
        mute?.disconnect();
        return false;
    } finally {
        if (url) URL.revokeObjectURL(url);
    }
};
