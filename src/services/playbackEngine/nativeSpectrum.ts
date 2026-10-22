import { isNativePlayerAvailable, nativePlayer } from './nativePlayerPlugin';
import { nativePlaybackEngine } from './nativePlaybackEngine';
import type { SpectrumSnapshot } from '../spectrumTap';

// src/services/playbackEngine/nativeSpectrum.ts
/**
 * 原生频谱在 Web 侧的接收端（P2）。
 *
 * 原生出声之后 WebView 那张 Web Audio 图是断的（`createMediaElementSource` 单向不可逆），
 * AudioWorklet 那个抽头抽到的是一条没有信号的路 —— 播放页的柱子全趴下。所以频谱改由
 * 原生这一侧采：`Visualizer(audioSessionId)`，只采当前这一首，比全局混音（session 0）
 * 更准，也不会被别的 App 的声音混进来。
 *
 * 出来的形状刻意与 `spectrumTap`（Web 那条路）**完全一致**，于是
 * `usePlaybackVisualizerBridge` 里那个 `tapped` 分支一行都不用改：
 * 谁先到用谁，两条路对下游是同一份东西。
 *
 * 采集由 Web 侧显式开关（20 帧/秒 × 128 段是要过桥的，页面藏起来就别推了）。
 */

/** 超过这么久没有新帧，就当这一路没接上（没权限 / 蓝牙 A2DP 不给数据）。 */
const STALE_MS = 1000;

let latest: SpectrumSnapshot | null = null;
let enabled = false;
let subscribed = false;

const subscribeOnce = (): void => {
    if (subscribed) return;
    subscribed = true;
    nativePlaybackEngine.subscribe(event => {
        if (event.type !== 'spectrum' || !event.bands) return;
        const raw = event.spectrum;
        const spectrum = new Uint8Array(raw && raw.length > 0 ? raw.length : 128);
        if (raw) {
            for (let index = 0; index < raw.length && index < spectrum.length; index += 1) {
                spectrum[index] = raw[index];
            }
        }
        latest = {
            spectrum,
            bass: event.bands.bass ?? 0,
            lowMid: event.bands.lowMid ?? 0,
            mid: event.bands.mid ?? 0,
            vocal: event.bands.vocal ?? 0,
            treble: event.bands.treble ?? 0,
            at: Date.now(),
        };
    });
};

/** 开关采集。幂等：状态没变就一个字节都不多说（桥只有一条）。 */
export const setNativeSpectrumEnabled = async (next: boolean): Promise<void> => {
    if (!isNativePlayerAvailable()) return;
    if (next === enabled) return;
    enabled = next;
    if (!next) {
        // 关的时候把最后一帧丢掉：留着会让下游以为还在采，画一份冻住的频谱。
        latest = null;
        await nativePlayer.setSpectrumEnabled(false).catch(() => undefined);
        return;
    }
    subscribeOnce();
    await nativePlayer.setSpectrumEnabled(true).catch(() => undefined);
};

/** 最新一帧；没开或这路没接上就是 null，让下游退回 AnalyserNode。 */
export const readNativeSpectrum = (): SpectrumSnapshot | null => {
    if (!enabled || !latest) return null;
    if (Date.now() - latest.at > STALE_MS) return null;
    return latest;
};
