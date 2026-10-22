import { Capacitor, registerPlugin } from '@capacitor/core';

// src/services/playbackEngine/nativePlayerPlugin.ts
//
// 原生播放内核的 JS 侧声明（P1）。与 android/.../player/FoliaNativePlayerPlugin.java 一一对应：
// 方法名、事件名（`foliaNativePlayer`）、字段名改一处两边都要改。

export type NativePlaybackEventType =
    | 'ready'
    | 'playing'
    | 'paused'
    | 'ended'
    | 'position'
    | 'buffering'
    | 'error'
    | 'idle'
    | 'spectrum';

export type NativePlaybackEvent = {
    type: NativePlaybackEventType;
    positionMs?: number;
    durationMs?: number;
    message?: string;
    /**
     * 频谱的整条（P2）：128 段，0..255，与 `getByteFrequencyData` 同量纲 ——
     * 于是 `usePlaybackVisualizerBridge` 里那个 `tapped` 分支能原样吃下去。
     */
    spectrum?: number[];
    /** 五个频段，同样是 0..255。 */
    bands?: {
        bass: number;
        lowMid: number;
        mid: number;
        vocal: number;
        treble: number;
        power: number;
    };
};

export type NativePlaybackSnapshot = {
    positionMs: number;
    durationMs: number;
    playing: boolean;
    audioSessionId: number;
};

interface FoliaNativePlayerPlugin {
    prepare(options: {
        url: string;
        startPositionMs?: number | null;
        /** Player.REPEAT_MODE_OFF(0) / ONE(1) / ALL(2)，与 androidx.media3.common.Player 一致。 */
        repeatMode?: number | null;
    }): Promise<{ ok: boolean }>;
    play(): Promise<void>;
    pause(): Promise<void>;
    stop(): Promise<void>;
    seek(options: { positionMs: number }): Promise<void>;
    setVolume(options: { volume: number }): Promise<void>;
    setSpeed(options: { speed: number }): Promise<void>;
    getSnapshot(): Promise<NativePlaybackSnapshot>;
    release(): Promise<void>;
    /** 频谱采集的开关（P2）。关着的时候原生一个字节都不推。 */
    setSpectrumEnabled(options: { enabled: boolean }): Promise<void>;
    addListener(
        eventName: 'foliaNativePlayer',
        listener: (event: NativePlaybackEvent) => void,
    ): Promise<() => void>;
}

const FoliaNativePlayer = registerPlugin<FoliaNativePlayerPlugin>('FoliaNativePlayer');

/**
 * 这个插件是不是真的在。
 *
 * ⚠️ 不能用 `typeof FoliaNativePlayer?.play === 'function'` 判：registerPlugin() 给回来的是
 * 代理，方法名问过去永远是 function，原生侧一行没写也会返回 true。必须查原生上报的
 * pluginHeaders（同步），否则会出现「开关开着、播放器其实不存在」的静默降级。
 */
export const isNativePlayerAvailable = (): boolean => {
    if (typeof Capacitor === 'undefined') return false;
    if (!Capacitor.isNativePlatform()) return false;
    return Capacitor.isPluginAvailable('FoliaNativePlayer');
};

export const nativePlayer = {
    prepare: (options: Parameters<FoliaNativePlayerPlugin['prepare']>[0]) => FoliaNativePlayer.prepare(options),
    play: () => FoliaNativePlayer.play(),
    pause: () => FoliaNativePlayer.pause(),
    stop: () => FoliaNativePlayer.stop(),
    seek: (positionMs: number) => FoliaNativePlayer.seek({ positionMs }),
    setVolume: (volume: number) => FoliaNativePlayer.setVolume({ volume }),
    setSpeed: (speed: number) => FoliaNativePlayer.setSpeed({ speed }),
    getSnapshot: () => FoliaNativePlayer.getSnapshot(),
    release: () => FoliaNativePlayer.release(),
    setSpectrumEnabled: (enabled: boolean) => FoliaNativePlayer.setSpectrumEnabled({ enabled }),
    addListener: (listener: (event: NativePlaybackEvent) => void) =>
        FoliaNativePlayer.addListener('foliaNativePlayer', listener),
};
