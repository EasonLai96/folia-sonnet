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

/**
 * 收到的那一帧是**两个字符串**（见 nativePlayerPlugin 的类型注释）：
 * 频谱走 base64、五个频段是一段逗号分隔的数字。这么打包是为了让桥上每一帧只有一个
 * 扁平短串要序列化 —— 20 帧/秒 × 128 个数字走 JSON 数组，界面会周期性卡一下。
 *
 * ⚠️ 解出来的数组**必须每次新建**：下游 `audioBands.spectrum.set(...)` 走的是
 * framer-motion 的 motion value，它按**引用**判变化 —— 复用同一份缓冲的话，内容变了
 * 引用没变，订阅者一次都不会被通知，频谱就整个静止了（Web 那条 spectrumTap 也是
 * 每帧 new 一个，同一个理由）。128 字节一次、一秒二十次，这笔分配不值得优化。
 */
const decodeSpectrum = (encoded: string): Uint8Array<ArrayBuffer> => {
    const binary = atob(encoded);
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        out[index] = binary.charCodeAt(index);
    }
    return out;
};

const subscribeOnce = (): void => {
    if (subscribed) return;
    subscribed = true;
    nativePlaybackEngine.subscribe(event => {
        if (event.type !== 'spectrum' || !event.bands) return;
        const parts = String(event.bands).split(',');
        latest = {
            spectrum: event.spectrum ? decodeSpectrum(event.spectrum) : new Uint8Array(128),
            bass: Number(parts[0]) || 0,
            lowMid: Number(parts[1]) || 0,
            mid: Number(parts[2]) || 0,
            vocal: Number(parts[3]) || 0,
            treble: Number(parts[4]) || 0,
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
