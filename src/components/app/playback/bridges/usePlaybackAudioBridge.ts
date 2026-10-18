import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { PlayerState } from '../../../../types';
import type { ReplayGainInfo, ReplayGainMode, SongResult, StatusMessage } from '../../../../types';
import type { LocalSong } from '../../../../types';
import { resolveNavidromePlaybackCarrier } from '../../../../utils/appPlaybackGuards';
import { calculateReplayGain } from '../../../../utils/replayGain';
import { applyAudioEqualizerSettings } from '../../../../services/audioEqualizerGraph';
import { type AudioEffectChain } from '../../../../services/audioEffects/effectChain';
import { buildPlaybackGraph } from '../../../../services/playbackGraph';
import { createSpectrumTap } from '../../../../services/spectrumTap';
import { cachePlayedTrackAssets } from '../../../../services/playedTrackCache';
import { registerPlaybackFadeGraph } from '../../../../services/playbackFade';
import { rampGain, type AutomixDeckChain } from '../../../../services/automix/crossfadeGraph';
import { setStatusMessage as setStatusMsg } from '../../../../stores/useStatusMessageStore';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { setPlayerState } from '../../../../stores/usePlaybackStore';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { noteAnalyser, noteAudioContext } from '../../../../utils/mediaDiagnostics';

// src/components/app/playback/bridges/usePlaybackAudioBridge.ts

/**
 * 输出缓冲要留多大 —— 直接给秒数，不用那三个档位名。
 *
 * 档位名（`interactive` / `balanced` / `playback`）落到多少毫秒全看浏览器实现，安卓 WebView
 * 上跟桌面 Chrome 差得远；给秒数是规范里的另一种写法（"首选最大延迟"），量纲是绝对的 ——
 * 改一个数就知道自己要求了什么，真机之间也才有可比性。
 *
 * 取值卡在两件事中间：
 *
 *  · **太小就撕裂**：CPU 一被可视化 / 封面解码 / 整墙重渲染占满，音频线程就交不上样本，
 *    缓冲空一次就是一声撕裂/爆音（underrun）。默认的 `interactive` 只给几十毫秒，最早那版
 *    就是一路这么响；抬到 `balanced` 后只剩高负载下偶发，所以现在再往上抬一档。
 *  · **太大则音频延迟变长**：点了暂停之后声音还会多响这么久。这是抬缓冲唯一的代价。
 *
 * ⚠️ 下面这条**已经不成立**，留着是因为它解释了这个数为什么一度卡在 0.1：
 *
 *  · ~~太大就掉帧~~：那时取频谱是每帧同步调 `getByteFrequencyData()`，一度以为是「缓冲越大
 *    那一次等得越久」。其实那条因果链本身就是错的：`getByteFrequencyData()` 的开销是**在主
 *    线程上现算一遍 FFT**，跟输出缓冲多大没关系。真正把它拿掉的是 `b55a8305` —— 频谱改由
 *    音频线程抽（AudioWorklet），主线程只读最新一份、一次都不等，两个方向就此解耦。
 *    （那条路还一直没真正接上，挂在 suspended 的 context 上 `addModule` 不推进；
 *    2026-10-18 修掉，日志里出现「[SpectrumTap] 频谱由音频线程抽」即为生效。）
 *
 * 所以现在这个数只在「抗撕裂」和「音频延迟」之间取舍，**与掉帧无关**。默认抬到 0.2s 只是想
 * 让音频线程每秒被唤醒的次数再少一点（0.1s 已经是每秒十来次，再往上收益很有限）—— 别指
 * 望它治卡顿，它治的是高负载下的撕裂。
 *
 * 运行时可调，见下面的 installLatencyHintKnob：
 *   `__foliaSetAudioLatencyHint(0.3)`  →  **重启 App** 才生效
 * 生效没有不看 hint，看开发者选项里 "ctx latency" 那行的 baseLatency / outputLatency。
 */
const AUDIO_LATENCY_HINT_STORAGE_KEY = 'folia_audio_output_latency_hint_sec';
const AUDIO_OUTPUT_LATENCY_HINT_DEFAULT_SEC = 0.2;
const AUDIO_OUTPUT_LATENCY_HINT_MIN_SEC = 0.005;
const AUDIO_OUTPUT_LATENCY_HINT_MAX_SEC = 0.5;

const clampLatencyHint = (value: number): number =>
    Math.min(AUDIO_OUTPUT_LATENCY_HINT_MAX_SEC, Math.max(AUDIO_OUTPUT_LATENCY_HINT_MIN_SEC, value));

const readLatencyHint = (): number => {
    if (typeof window === 'undefined') return AUDIO_OUTPUT_LATENCY_HINT_DEFAULT_SEC;
    const raw = window.localStorage.getItem(AUDIO_LATENCY_HINT_STORAGE_KEY);
    if (raw === null) return AUDIO_OUTPUT_LATENCY_HINT_DEFAULT_SEC;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return AUDIO_OUTPUT_LATENCY_HINT_DEFAULT_SEC;
    return clampLatencyHint(parsed);
};

/**
 * 运行时改缓冲，省得每试一个值就重新打一次包。
 *
 * ⚠️ `latencyHint` 只在 **new AudioContext 的那一刻** 被读走，而这个 ctx 建好之后一直活到
 * App 退出（它挂在一个 ref 上，离开播放页不拆）。所以**改完必须重启 App** 才生效 —— 光退到
 * 首页再进来没用。
 *
 * 怎么知道落到了哪一档：hint 只是「请求」，安卓 WebView 完全可以无视它、或者给你夹到硬件
 * 支持的那一档；0.2 和 0.3 很可能落到同一个缓冲区上。判据不看 hint，看 **baseLatency /
 * outputLatency**（开发者选项里的 "ctx latency" 一行）—— 两个数没动，就说明这个改动在这一
 * 台机器上是空转，别再往上试了。
 */
const installLatencyHintKnob = (): void => {
    if (typeof window === 'undefined') return;
    (window as Window & typeof globalThis & {
        __foliaSetAudioLatencyHint?: (seconds: number) => number;
    }).__foliaSetAudioLatencyHint = (seconds: number) => {
        const next = clampLatencyHint(Number(seconds));
        window.localStorage.setItem(AUDIO_LATENCY_HINT_STORAGE_KEY, String(next));
        console.info(
            `[AudioContext] 输出缓冲请求改成 ${next}s（有效区间 ${AUDIO_OUTPUT_LATENCY_HINT_MIN_SEC}~${AUDIO_OUTPUT_LATENCY_HINT_MAX_SEC}s），重启 App 生效`,
        );
        return next;
    };
};
installLatencyHintKnob();

type UsePlaybackAudioBridgeParams = {

    audioRef: RefObject<HTMLAudioElement | null>;
    localSongs: LocalSong[];
    isLyricsLoading: boolean;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    audioContextRef: MutableRefObject<AudioContext | null>;
    analyserRef: MutableRefObject<AnalyserNode | null>;
    gainNodeRef: MutableRefObject<GainNode | null>;
    /** Wires both automix decks into the shared mix point. Returns false if a deck is missing. */
    connectDecks: (context: AudioContext, output: AudioNode) => boolean;
    /** The deck the app is currently listening through, for per-track loudness compensation. */
    getActiveChain: () => AutomixDeckChain | null;
    /** Set when a pause interrupted an armed transition; suppresses exactly one autoplay. */
    suppressAutoplayRef: MutableRefObject<boolean>;
    /** True while automix has the next track loaded but its blend is not due to start yet. */
    isAutoplayHeld: boolean;
    syncOutputGain: (targetVolume: number, smoothing?: number) => void;
    getTargetPlaybackVolume: () => number;
    getCoverUrl: () => string | null;
};

// Bridges audio element setup, autoplay, replay gain, and media caching.
export function usePlaybackAudioBridge({
    audioRef,
    localSongs,
    isLyricsLoading,
    shouldAutoPlayRef,
    audioContextRef,
    analyserRef,
    gainNodeRef,
    connectDecks,
    getActiveChain,
    suppressAutoplayRef,
    isAutoplayHeld,
    syncOutputGain,
    getTargetPlaybackVolume,
    getCoverUrl,
}: UsePlaybackAudioBridgeParams) {
    // Read here rather than passed in: all store fields or i18n.
    const { t } = useTranslation();
    const audioSrc = usePlaybackStore(state => state.audioSrc);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const replayGainMode = usePlaybackStore(state => state.replayGainMode);
    const enableMediaCache = useAudioSettingsStore(state => state.enableMediaCache);

    const previousAudioSrcRef = useRef<string | null>(null);
    const replayGainLogSignatureRef = useRef<string | null>(null);
    const equalizerNodesRef = useRef<BiquadFilterNode[]>([]);
    const effectChainRef = useRef<AudioEffectChain | null>(null);
    const audioEqualizerSettings = useAudioSettingsStore(state => state.audioEqualizerSettings);

    // Recalculates source-specific gain after the audio graph or playback settings become ready.
    const applyReplayGain = useCallback(() => {
        if (!currentSong || !gainNodeRef.current || !audioContextRef.current) return;

        let replayGainInfo: ReplayGainInfo | undefined;
        const localSongId = (currentSong as SongResult & { localRef?: { songId: string } }).localRef?.songId;
        const localData = localSongId ? localSongs.find(song => song.id === localSongId) : undefined;
        if ((currentSong as SongResult & { isLocal?: boolean }).isLocal && localData) {
            replayGainInfo = {
                trackGain: typeof localData.replayGainTrackGain === 'number'
                    ? localData.replayGainTrackGain
                    : localData.replayGain,
                trackPeak: localData.replayGainTrackPeak,
                albumGain: localData.replayGainAlbumGain,
                albumPeak: localData.replayGainAlbumPeak,
            };
        }

        const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
        const navidromeReplayGain = navidromeSong?.navidromeData.replayGain;
        if (navidromeReplayGain) {
            replayGainInfo = navidromeReplayGain;
        }

        if (currentSong.sourceRef?.kind === 'online') {
            replayGainInfo = currentSong.replayGain;
        }

        const calculation = calculateReplayGain(replayGainInfo, replayGainMode);

        try {
            // Onto the deck rather than the shared output: loudness compensation is a per-track
            // value, so during a blend the two decks legitimately need different ones.
            const activeChain = getActiveChain();
            if (activeChain) {
                rampGain(audioContextRef.current, activeChain.replayGain, calculation.linearGain, 0.1);
            }

            const replayGainLogSignature = JSON.stringify({
                songId: currentSong.id,
                mode: replayGainMode,
                raw: calculation.gainDb,
                effective: calculation.effectiveGainDb,
                peak: calculation.peak ?? null,
            });

            if (replayGainLogSignatureRef.current !== replayGainLogSignature) {
                replayGainLogSignatureRef.current = replayGainLogSignature;
                console.log(`[AudioContext] ReplayGain mode=${replayGainMode} gain=${calculation.effectiveGainDb}dB (raw=${calculation.gainDb}dB, peak=${calculation.peak ?? 'n/a'}, linear=${calculation.linearGain.toFixed(2)})`);
            }
        } catch (error) {
            console.warn('[AudioContext] Failed to apply ReplayGain', error);
        }
    }, [audioContextRef, currentSong, gainNodeRef, getActiveChain, localSongs, replayGainMode]);

    const setupAudioAnalyzer = useCallback(() => {
        // The context is the sentinel, not the source node: a deck that failed to connect must
        // not let this run twice, because createMediaElementSource throws on a second call.
        if (!audioRef.current || audioContextRef.current) return;
        try {
            const AudioContextClass = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            // 放音乐要的是稳，不是浏览器那一小格交互缓冲 —— 用哪个数、为什么是这个数，
            // 见上面的 AUDIO_OUTPUT_LATENCY_HINT_DEFAULT_SEC。别改回 'playback'：那一档会把
            // 播放页的每帧取频谱拖垮（实测它是掉帧元凶），真要再大就把可视化那一侧一起降频。
            const latencyHint = readLatencyHint();
            const ctx = new AudioContextClass({ latencyHint });
            audioContextRef.current = ctx;
            noteAudioContext(ctx, latencyHint);

            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.6;
            analyserRef.current = analyser;
            // 只为那张频谱读数：让它能分清「analyser 没建」和「建了但没数据」。
            noteAnalyser(analyser);

            const { gainNode, fadeNode, effectChain, decksConnected } = buildPlaybackGraph({
                context: ctx,
                analyser,
                connectDecks,
                equalizerNodesRef,
                settings: audioEqualizerSettings,
            });
            gainNodeRef.current = gainNode;
            // Hands the transport its own fade node; until this runs (or if setup fails) pause and
            // resume see no graph and fall back to plain element pause/play.
            registerPlaybackFadeGraph({ context: ctx, gain: fadeNode });
            effectChainRef.current = effectChain;
            if (!decksConnected) {
                console.warn('[AudioContext] Deck setup incomplete, automix will stay idle');
            }

            /*
             * 频谱改由音频线程抽（AudioWorklet），主线程只读最新一份 —— 见 services/spectrumTap。
             *
             * 这一步是**加成**不是依赖：走不通（没有 AudioWorklet / WebView 不让加载 Blob）
             * 它就自己返回 false，取频谱照旧走 analyser 的 getByteFrequencyData，只是那就还是
             * 每帧等一次音频线程。挂在 analyser 之后，拿到的是同一份信号。
             *
             * 但要**等这个 ctx 真的跑起来再挂**：它是上面那一行刚 new 出来的，自动播放策略下
             * 通常还停在 `suspended`（要等一次用户手势才 resume，而 resume 是异步的）。
             * `audioWorklet.addModule()` 的 Promise 在 suspended 的 context 上并不保证推进 ——
             * 挂在还没跑起来的 ctx 上，tap 就一直建不起来，取频谱永远落在 AnalyserNode 那条
             * 同步兜底上。界面上的症状是整页掉帧、而且所有可视化模式一起慢。
             */
            const attachSpectrumTap = () => {
                void createSpectrumTap(ctx, analyser, {
                    fftSize: 2048,
                    // 与上面 analyser 的平滑同一个值：换一条路不等于换一套观感。
                    smoothingTimeConstant: analyser.smoothingTimeConstant,
                });
            };

            if (ctx.state === 'running') {
                attachSpectrumTap();
            } else {
                const onContextStateChange = () => {
                    if (ctx.state !== 'running') return;
                    ctx.removeEventListener('statechange', onContextStateChange);
                    attachSpectrumTap();
                };
                ctx.addEventListener('statechange', onContextStateChange);
            }

            applyReplayGain();
            syncOutputGain(getTargetPlaybackVolume(), 0);
        } catch (error) {
            console.error('Audio Context Setup Failed:', error);
        }
    }, [analyserRef, applyReplayGain, audioContextRef, audioEqualizerSettings, audioRef, connectDecks, gainNodeRef, getTargetPlaybackVolume, syncOutputGain]);

    /**
     * Writes a fully-played track's audio and cover into the media cache.
     *
     * Takes the song and its source explicitly rather than reading `currentSong`/`audioSrc`, because
     * the automix settle path caches the track that just faded OUT - and by then the app's own state
     * already names the track that arrived. `coverUrl` is passed for the currently-displayed track
     * (which may carry a user override); left undefined - the automix path - the cover is taken from
     * the song's own metadata instead.
     *
     * The writes themselves live in `cachePlayedTrackAssets`, which is where the audio and cover
     * conditions are kept apart from each other; this only adds the setting gate, which does not
     * belong in a service.
     */
    const cacheSongAssetsFor = useCallback(async (
        song: SongResult | null,
        src: string | null,
        coverUrl?: string | null,
    ) => {
        if (!enableMediaCache) return;

        await cachePlayedTrackAssets(song, src, coverUrl);
    }, [enableMediaCache]);

    const cacheSongAssets = useCallback(
        () => cacheSongAssetsFor(currentSong, audioSrc, getCoverUrl()),
        [audioSrc, cacheSongAssetsFor, currentSong, getCoverUrl],
    );

    useEffect(() => {
        if (audioRef.current) {
            syncOutputGain(getTargetPlaybackVolume(), 0.015);
        }
    }, [audioRef, getTargetPlaybackVolume, syncOutputGain]);

    useEffect(() => {
        localStorage.setItem('local_replaygain_mode', replayGainMode);
    }, [replayGainMode]);

    useEffect(() => {
        applyReplayGain();
    }, [applyReplayGain]);

    useEffect(() => {
        const context = audioContextRef.current;
        if (!context || equalizerNodesRef.current.length === 0) {
            return;
        }
        applyAudioEqualizerSettings(context, equalizerNodesRef.current, audioEqualizerSettings);
        effectChainRef.current?.apply(audioEqualizerSettings.effects, audioEqualizerSettings.enabled);
    }, [audioContextRef, audioEqualizerSettings]);

    useEffect(() => () => {
        effectChainRef.current?.dispose();
        effectChainRef.current = null;
    }, []);

    useEffect(() => {
        const audioElement = audioRef.current;
        if (!audioElement) {
            previousAudioSrcRef.current = audioSrc;
            return;
        }

        if (audioSrc && previousAudioSrcRef.current && previousAudioSrcRef.current !== audioSrc) {
            audioElement.pause();
            audioElement.load();
        }

        previousAudioSrcRef.current = audioSrc;
    }, [audioRef, audioSrc]);

    useEffect(() => {
        if (audioSrc && audioRef.current) {
            // `audioRef` and `audioSrc` describe the same track almost always - but not while a
            // blend is being armed. Automix repoints the ref at the incoming deck the instant it
            // arms, and `audioSrc` keeps naming the OUTGOING track until playSong has resolved the
            // next URL, which takes an await or two. Playing in that window starts whatever the
            // incoming deck still had loaded from an earlier song AND spends the autoplay intent
            // on it, so when the real source lands there is nothing left to press play with: the
            // deck sits fully buffered at currentTime 0 in silence.
            //
            // The deck's own src attribute is written from `audioSrc`, so an exact match is the
            // whole test. Bail WITHOUT spending the intent - this effect runs again on the commit
            // that gives the deck its real source, and that run is the one meant to start it.
            if (audioRef.current.getAttribute('src') !== audioSrc) return;

            // The deck has already failed on this exact source and something else - the transcode
            // fallback - is off resolving it. play() on an element in error state cannot start
            // anything; it rejects with NotSupportedError. Pressing it here only spends the intent,
            // so when the recovered source lands there is nothing left to start the deck with.
            // Bail WITHOUT spending it, the same way the autoplay hold below does: replacing the
            // source runs this effect again, and that run is the one meant to start it.
            if (audioRef.current.error) return;

            if (shouldAutoPlayRef.current && !isLyricsLoading) {
                // The deck has its source and is buffering, but its blend is not due yet. Bail
                // WITHOUT spending the intent - this effect runs again when the hold lifts, and
                // that run is the one meant to start it.
                //
                // This is what keeps the load out of the blend. Pressing play here instead starts
                // the fade wherever loading happened to finish, which took the same second or two
                // off every transition and capped an eight second plan at three.
                if (isAutoplayHeld) {
                    // The outgoing deck is still sounding. playSong dropped the state to IDLE on
                    // its way past and nothing else puts it back until this deck starts, so left
                    // alone the transport reads "stopped" for the whole lead - and the play button
                    // it offers would start this deck early and take the blend with it.
                    setPlayerState(PlayerState.PLAYING);
                    return;
                }

                shouldAutoPlayRef.current = false;

                // Automix starts the next track seconds early, so a pause can land after the
                // advance is already in flight and too late to recall. Honour the pause instead:
                // without this the listener presses pause and the next song starts anyway.
                if (suppressAutoplayRef.current) {
                    suppressAutoplayRef.current = false;
                    setPlayerState(PlayerState.PAUSED);
                    return;
                }

                syncOutputGain(getTargetPlaybackVolume(), 0);
                const playPromise = audioRef.current.play();
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            setPlayerState(PlayerState.PLAYING);
                            setupAudioAnalyzer();
                        })
                        .catch(error => {
                            if (audioRef.current && !audioRef.current.paused && !audioRef.current.ended) {
                                setPlayerState(PlayerState.PLAYING);
                                return;
                            }

                            // A load() landing between play() and its promise aborts the play.
                            // That happens whenever the source changes again while a track is
                            // still starting - skipping during an automix transition is the
                            // reliable way to see it - and the autoplay flag was spent before
                            // play() was ever called, so nothing would press play again and the
                            // app sits silent. Put the intent back for the next run.
                            if (error.name === 'AbortError') {
                                shouldAutoPlayRef.current = true;
                                return;
                            }

                            if (error.name === 'NotAllowedError') {
                                setStatusMsg({ type: 'info', text: t('status.clickToPlay') });
                                setPlayerState(PlayerState.PAUSED);
                            }
                        });
                }
            }
        }
    }, [audioRef, audioSrc, getTargetPlaybackVolume, isAutoplayHeld, isLyricsLoading, setPlayerState, setStatusMsg, setupAudioAnalyzer, shouldAutoPlayRef, suppressAutoplayRef, syncOutputGain, t]);

    // Tells this bridge that the active deck ALREADY holds `src` and is sounding it, so the next time
    // `audioSrc` settles on that value the reload effect above treats it as a no-op instead of calling
    // load(). Used when a transition is cancelled back onto the deck still playing the outgoing track:
    // that deck has the song loaded and playing, and reloading it would run the whole song-change
    // shape - a fresh load, a visible hitch - for a track that never actually left.
    const adoptActiveDeckSource = useCallback((src: string) => {
        previousAudioSrcRef.current = src;
    }, []);

    return {
        setupAudioAnalyzer,
        cacheSongAssets,
        cacheSongAssetsFor,
        adoptActiveDeckSource,
    };
}
