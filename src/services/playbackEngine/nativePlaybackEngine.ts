import { nativePlayer, type NativePlaybackEvent } from './nativePlayerPlugin';

// src/services/playbackEngine/nativePlaybackEngine.ts
//
// 原生播放内核在 Web 侧的那一半：一个进程里只有一个播放器，所以这里是单例。
//
// 时钟是这里最容易做错的地方。原生播放器**不会**给逐帧位置 —— 它每 250ms 推一次
// `position`，而歌词、进度条都是按帧读的。所以位置要按本地墙钟插值补出来：
//
//     真实位置 ≈ 最后一次上报的位置 + (现在 − 那次上报的时刻) × 倍速
//
// 绝不反过来做「Web 侧每秒调 getSnapshot 问一次」：Capacitor 的桥只有一条，
// 轮询会和批量拉取那些操作抢同一条通道（成片 cookie 超时就是这么来的）。
//
// 夹在 duration 之内：缓冲、切歌之后插出来的值可能越过结尾，
// 一首 4 分钟的歌进度条冲到 4:07 再弹回来很难看。

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

class NativePlaybackEngine {
    private positionMs = 0;
    private durationMs = 0;
    private playing = false;
    private hasSource = false;
    private rate = 1;
    private updatedAtMs = 0;
    private repeatMode = 0;
    private volume = 1;
    private currentUrl: string | null = null;
    private listeners = new Set<(event: NativePlaybackEvent) => void>();
    private subscriptionStarted = false;

    /**
     * 这个地址能不能交给原生。
     *
     * `blob:` 不行 —— 那是 WebView 自己造的对象 URL（本地歌、以及**媒体缓存副本**），
     * 原生进程根本看不到它。遇到这种地址整首回落到 `<audio>`，等缓存搬进私有目录
     * （后面的阶段）再说。
     */
    supports(url: string | null | undefined): boolean {
        if (!url) return false;
        if (url.startsWith('blob:')) return false;
        if (url.startsWith('data:')) return false;
        return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('content://') || url.startsWith('file://');
    }

    /** 当前是不是由原生在播（用来决定进度条走哪条时钟）。 */
    activeUrl(): string | null {
        return this.hasSource ? this.currentUrl : null;
    }

    isPlaying(): boolean {
        return this.hasSource && this.playing;
    }

    /** 插值后的当前位置（秒）。没有源时给 0。 */
    getPositionSec(): number {
        if (!this.hasSource) return 0;
        if (!this.playing) return this.positionMs / 1000;
        const elapsed = Math.max(0, performance.now() - this.updatedAtMs);
        const predicted = this.positionMs + elapsed * this.rate;
        const upper = this.durationMs > 0 ? this.durationMs : Number.MAX_SAFE_INTEGER;
        return clamp(predicted, 0, upper) / 1000;
    }

    getDurationSec(): number {
        return this.durationMs > 0 ? this.durationMs / 1000 : 0;
    }

    async setSource(url: string, options: { startPositionMs?: number | null; repeatMode?: number } = {}): Promise<void> {
        this.ensureSubscription();
        this.currentUrl = url;
        this.hasSource = true;
        this.playing = false;
        this.positionMs = options.startPositionMs ?? 0;
        this.durationMs = 0;
        this.updatedAtMs = performance.now();
        if (typeof options.repeatMode === 'number') this.repeatMode = options.repeatMode;
        await nativePlayer.prepare({
            url,
            startPositionMs: options.startPositionMs ?? null,
            repeatMode: this.repeatMode,
        });
        await nativePlayer.setVolume(this.volume);
    }

    async play(): Promise<void> {
        await nativePlayer.play();
        // 播放意图先记下：等 `playing` 事件回来之前，进度条不该停在原地不动。
        this.playing = true;
        this.updatedAtMs = performance.now();
    }

    async pause(): Promise<void> {
        await nativePlayer.pause();
        this.playing = false;
    }

    async seek(seconds: number): Promise<void> {
        const targetMs = Math.max(0, Math.round(seconds * 1000));
        this.positionMs = targetMs;
        this.updatedAtMs = performance.now();
        await nativePlayer.seek(targetMs);
    }

    async stop(): Promise<void> {
        this.hasSource = false;
        this.playing = false;
        this.positionMs = 0;
        this.durationMs = 0;
        this.currentUrl = null;
        await nativePlayer.stop();
    }

    setVolume(volume: number): void {
        this.volume = clamp(volume, 0, 1);
        if (!this.hasSource) return;
        void nativePlayer.setVolume(this.volume).catch(() => undefined);
    }

    setSpeed(speed: number): void {
        this.rate = clamp(speed, 0.1, 4);
        if (!this.hasSource) return;
        void nativePlayer.setSpeed(this.rate).catch(() => undefined);
    }

    setRepeatMode(repeatMode: number): void {
        // 只记下来：下一次 prepare 会带上它。已经在播的这一首不重新装地址 —— 那会把
        // 当前这一首从头再来一遍，而「单曲循环」是随时能按的。
        this.repeatMode = repeatMode;
    }

    subscribe(listener: (event: NativePlaybackEvent) => void): () => void {
        this.listeners.add(listener);
        this.ensureSubscription();
        return () => {
            this.listeners.delete(listener);
        };
    }

    private ensureSubscription(): void {
        if (this.subscriptionStarted) return;
        this.subscriptionStarted = true;
        void nativePlayer.addListener(event => {
            this.apply(event);
            this.listeners.forEach(listener => listener(event));
        }).catch(() => undefined);
    }

    private apply(event: NativePlaybackEvent): void {
        const now = performance.now();
        if (typeof event.positionMs === 'number') {
            this.positionMs = Math.max(0, event.positionMs);
            this.updatedAtMs = now;
        }
        if (typeof event.durationMs === 'number' && event.durationMs > 0) {
            this.durationMs = event.durationMs;
        }
        switch (event.type) {
            case 'playing':
                this.playing = true;
                this.updatedAtMs = now;
                break;
            case 'paused':
            case 'ended':
            case 'error':
            case 'idle':
                this.playing = false;
                break;
            default:
                break;
        }
    }
}

export const nativePlaybackEngine = new NativePlaybackEngine();
