import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { MotionValue } from 'framer-motion';
import { findLatestActiveLineIndex } from '../../../../utils/appPlaybackHelpers';
import { PlayerState } from '../../../../types';
import type { AudioBands, LyricData } from '../../../../types';
import { setCurrentLineIndex, setPlayerState } from '../../../../stores/usePlaybackStore';
import { selectDisplayLyrics, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { readLatestSpectrum } from '../../../../services/spectrumTap';
import { audioBands, audioPower, currentTime, lyricCurrentTime } from '../../../../stores/motionSignals';

// src/components/app/playback/bridges/usePlaybackVisualizerBridge.ts

type UsePlaybackVisualizerBridgeParams = {

    audioRef: MutableRefObject<HTMLAudioElement | null>;
    analyserRef: MutableRefObject<AnalyserNode | null>;
    animationFrameRef: MutableRefObject<number>;
    effectiveLoopMode: 'off' | 'all' | 'one' | 'shuffle';
    isNowPlayingStageActive: boolean;
    isPlayerCapStageActive: boolean;
    stageActiveEntryKind: string | null;
    stageLyricsSession: unknown;
    stageLyricsClockRef: MutableRefObject<{
        startTimeSec: number;
        endTimeSec: number;
        baseTimeSec: number;
        startedAtMs: number | null;
    }>;
    getSyntheticStageLyricsTime: () => number;
    syncStageLyricsClock: (timeSec: number, endTimeSec: number, nextPlayerState: PlayerState, startTimeSec?: number) => void;
    getNowPlayingDisplayTime: () => number;
    getPlayerCapDisplayTime: () => number;
    syncNowPlayingClock: (progressSec: number, durationSec: number, paused: boolean) => void;
    lyricTimelineOffsetMs: number;
    /** True while an automix handover is in progress and a deck other than the active one sounds. */
    isTransitionAudible: () => boolean;
    /**
     * The deck the on-screen track is playing on while a transition holds the picture, else null.
     *
     * The clock below has to follow whatever is on screen. From the moment a blend arms, the
     * active deck is seconds into the NEXT track while the title, cover and lyrics still belong to
     * the one finishing - so reading the active deck here puts the progress bar and the lyric
     * read-head near zero under a song that is three minutes in.
     */
    getDisplayElement?: () => HTMLAudioElement | null;
};

/**
 * 隔多久向音频线程要一次频谱。
 *
 * `getByteFrequencyData()` 是**同步**的：它要等音频线程把最近一次渲染结果交出来，输出缓冲
 * 越大等得越久 —— 而放音乐为了抗撕裂（underrun）恰恰要把缓冲开大，见 usePlaybackAudioBridge
 * 的 AUDIO_OUTPUT_LATENCY_HINT_SEC。播放页的 rAF 每帧跑一次 updateLoop，等于每帧都要付这一
 * 笔：缓冲开到 `playback` 那档时整页掉帧就是这么来的（且所有可视化模式一起慢，卡的是取频谱
 * 这一步，不是某个模式的绘制）。
 *
 * 降到 ~30Hz：频谱本来就过了一遍 `smoothingTimeConstant`（0.6）的平滑，少一半采样看不出来，
 * 但把大缓冲的代价砍掉了一半以上。中间那些帧不写信号，可视化自然沿用上一帧的读数。
 *
 * 只抬缓冲不动这里，等于把掉帧那条老路再走一遍 —— 两边是一套改动。
 */
const SPECTRUM_READ_INTERVAL_MS = 33;

// Runs the requestAnimationFrame loop for audio-reactive visuals and lyric timing.
export function usePlaybackVisualizerBridge({
    audioRef,
    analyserRef,
    animationFrameRef,
    effectiveLoopMode,
    isNowPlayingStageActive,
    isPlayerCapStageActive,
    stageActiveEntryKind,
    stageLyricsSession,
    stageLyricsClockRef,
    getSyntheticStageLyricsTime,
    syncStageLyricsClock,
    getNowPlayingDisplayTime,
    getPlayerCapDisplayTime,
    syncNowPlayingClock,
    lyricTimelineOffsetMs,
    isTransitionAudible,
    getDisplayElement,
}: UsePlaybackVisualizerBridgeParams) {
    // Read here rather than passed in: store fields and the module-level motion signals.
    const activePlaybackContext = usePlaybackStore(state => state.activePlaybackContext);
    const playerState = usePlaybackStore(state => state.playerState);
    const duration = usePlaybackStore(state => state.duration);
    // The lyrics on screen, matching the deck getDisplayElement points at.
    const lyrics = usePlaybackStore(selectDisplayLyrics);

    const currentLineIndexRef = useRef(-1);
    // 上一帧真的去问频谱是什么时候。只为那个 ~30Hz 的降频服务（见 SPECTRUM_READ_INTERVAL_MS）。
    const spectrumReadAtMsRef = useRef(0);

    const updateLoop = useCallback(() => {
        // Normally the active deck; the outgoing one for as long as a blend holds the picture on
        // the track it is finishing, so that clock and picture never describe different songs.
        const audioElement = getDisplayElement?.() ?? audioRef.current;
        const isActuallyPlaying = Boolean(audioElement && !audioElement.paused && !audioElement.ended);
        // Mid-handover a deck can be loading while the other one is still sounding. The analyser
        // is downstream of both, so it has real signal: dropping to the idle breath here would put
        // a visible stutter at exactly the moment meant to be seamless.
        const hasAudibleSignal = isActuallyPlaying || isTransitionAudible();
        /*
         * 频谱有两条路，能用哪条用哪条：
         *
         *  · **音频线程抽的那条**（services/spectrumTap）—— 拿到的是人家已经算好的一份，读它
         *    **一次都不等音频线程**，所以每一帧都能用，不必降频；
         *  · **AnalyserNode 那条** —— `getByteFrequencyData` 是同步的，要等音频线程把最近一次
         *    渲染结果交出来，缓冲越大等得越久，所以降到 ~30Hz（SPECTRUM_READ_INTERVAL_MS）。
         *
         * 第一条接不上（没有 AudioWorklet、或 WebView 不给加载）时自动落到第二条。
         */
        const tapped = readLatestSpectrum();
        // 取成局部变量：ref 上的 .current 进不了分支条件的窄化，后面要直接用它。
        const analyser = analyserRef.current;
        // 只有第二条才需要这个间隔。
        const nowMsValue = performance.now();
        const spectrumDue = nowMsValue - spectrumReadAtMsRef.current >= SPECTRUM_READ_INTERVAL_MS;
        const process = (value: number, boost = 2) => {
            const normalized = value / 255;
            return Math.pow(normalized, boost) * 255;
        };

        // 三态，不是二态：有信号但这一帧不该读频谱时**什么都不写** —— 沿用上一次的读数。
        // 写成 if/else 会让这些帧掉进 idle breath，律动就在真频谱和呼吸之间每帧来回跳。
        if (!hasAudibleSignal || (!tapped && !analyser)) {
            const time = Date.now() / 2000;
            const breath = (Math.sin(time) + 1) * 20;
            audioPower.set(breath);
            audioBands.bass.set(breath);
            audioBands.lowMid.set(breath);
            audioBands.mid.set(breath);
            audioBands.vocal.set(breath);
            audioBands.treble.set(breath);
            audioBands.spectrum?.set(new Uint8Array(0));
        } else if (tapped) {
            audioBands.spectrum?.set(tapped.spectrum);
            audioPower.set(process((tapped.bass + tapped.lowMid) / 2, 3));
            audioBands.bass.set(process(tapped.bass, 1.8));
            audioBands.lowMid.set(process(tapped.lowMid, 2));
            audioBands.mid.set(process(tapped.mid, 2));
            audioBands.vocal.set(process(tapped.vocal, 1.5));
            audioBands.treble.set(process(tapped.treble, 2));
        } else if (analyser && spectrumDue) {
            // 记在真正去读之前：这次同步等待算进间隔里，缓冲大也不会把节奏挤成一帧一次。
            spectrumReadAtMsRef.current = nowMsValue;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyser.getByteFrequencyData(dataArray);
            audioBands.spectrum?.set(dataArray);

            const getEnergy = (minHz: number, maxHz: number): number => {
                const start = Math.floor(minHz / 21.5);
                const end = Math.floor(maxHz / 21.5);
                let sum = 0;
                for (let index = start; index <= end; index += 1) {
                    sum += dataArray[index];
                }
                const count = end - start + 1;
                return count > 0 ? sum / count : 0;
            };

            const bass = getEnergy(20, 150);
            const lowMid = getEnergy(150, 400);
            const mid = getEnergy(400, 1200);
            const vocal = getEnergy(1000, 3500);
            const treble = getEnergy(3500, 12000);

            audioPower.set(process((bass + lowMid) / 2, 3));
            audioBands.bass.set(process(bass, 1.8));
            audioBands.lowMid.set(process(lowMid, 2));
            audioBands.mid.set(process(mid, 2));
            audioBands.vocal.set(process(vocal, 1.5));
            audioBands.treble.set(process(treble, 2));
        }

        if (isActuallyPlaying && audioElement) {
            const time = audioElement.currentTime;
            currentTime.set(time);

            const effectiveLyricTime = time - lyricTimelineOffsetMs / 1000;
            lyricCurrentTime.set(effectiveLyricTime);

            if (lyrics) {
                const foundIndex = findLatestActiveLineIndex(lyrics.lines, effectiveLyricTime);
                if (foundIndex !== currentLineIndexRef.current) {
                    currentLineIndexRef.current = foundIndex;
                    setCurrentLineIndex(foundIndex);
                }
            }
        } else if (isNowPlayingStageActive) {
            const nextTime = getNowPlayingDisplayTime();
            const hasReachedEnd = playerState === PlayerState.PLAYING && duration > 0 && nextTime >= duration;

            currentTime.set(nextTime);

            const effectiveLyricTime = nextTime - lyricTimelineOffsetMs / 1000;
            lyricCurrentTime.set(effectiveLyricTime);

            if (lyrics) {
                const foundIndex = findLatestActiveLineIndex(lyrics.lines, effectiveLyricTime);
                if (foundIndex !== currentLineIndexRef.current) {
                    currentLineIndexRef.current = foundIndex;
                    setCurrentLineIndex(foundIndex);
                }
            } else if (currentLineIndexRef.current !== -1) {
                currentLineIndexRef.current = -1;
                setCurrentLineIndex(-1);
            }

            if (hasReachedEnd) {
                if (effectiveLoopMode === 'one' || effectiveLoopMode === 'all') {
                    syncNowPlayingClock(0, duration, false);
                    currentTime.set(0);
                    if (lyrics) {
                        const restartedLineIndex = findLatestActiveLineIndex(lyrics.lines, 0);
                        if (restartedLineIndex !== currentLineIndexRef.current) {
                            currentLineIndexRef.current = restartedLineIndex;
                            setCurrentLineIndex(restartedLineIndex);
                        }
                    }
                } else {
                    syncNowPlayingClock(duration, duration, true);
                    setPlayerState(PlayerState.PAUSED);
                }
            }
        } else if (isPlayerCapStageActive) {
            // PlayerCap: clock extrapolated from progress×duration; a passive source, looping/ending is driven by the external player, so no end/loop handling here.
            const nextTime = getPlayerCapDisplayTime();
            currentTime.set(nextTime);

            const effectiveLyricTime = nextTime - lyricTimelineOffsetMs / 1000;
            lyricCurrentTime.set(effectiveLyricTime);

            if (lyrics) {
                const foundIndex = findLatestActiveLineIndex(lyrics.lines, effectiveLyricTime);
                if (foundIndex !== currentLineIndexRef.current) {
                    currentLineIndexRef.current = foundIndex;
                    setCurrentLineIndex(foundIndex);
                }
            } else if (currentLineIndexRef.current !== -1) {
                currentLineIndexRef.current = -1;
                setCurrentLineIndex(-1);
            }
        } else if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && stageLyricsSession && lyrics) {
            const nextTime = getSyntheticStageLyricsTime();
            const clock = stageLyricsClockRef.current;
            const hasReachedEnd = playerState === PlayerState.PLAYING && nextTime >= clock.endTimeSec;

            currentTime.set(nextTime);

            const foundIndex = findLatestActiveLineIndex(lyrics.lines, nextTime);
            if (foundIndex !== currentLineIndexRef.current) {
                currentLineIndexRef.current = foundIndex;
                setCurrentLineIndex(foundIndex);
            }

            if (hasReachedEnd) {
                if (effectiveLoopMode === 'one' || effectiveLoopMode === 'all') {
                    syncStageLyricsClock(clock.startTimeSec, clock.endTimeSec, PlayerState.PLAYING, clock.startTimeSec);
                    currentTime.set(clock.startTimeSec);
                    const restartedLineIndex = findLatestActiveLineIndex(lyrics.lines, clock.startTimeSec);
                    if (restartedLineIndex !== currentLineIndexRef.current) {
                        currentLineIndexRef.current = restartedLineIndex;
                        setCurrentLineIndex(restartedLineIndex);
                    }
                } else {
                    syncStageLyricsClock(clock.endTimeSec, clock.endTimeSec, PlayerState.PAUSED, clock.startTimeSec);
                    setPlayerState(PlayerState.PAUSED);
                }
            }
        }

        animationFrameRef.current = requestAnimationFrame(updateLoop);
    }, [
        activePlaybackContext,
        analyserRef,
        animationFrameRef,
        audioBands,
        audioPower,
        audioRef,
        currentTime,
        duration,
        effectiveLoopMode,
        getNowPlayingDisplayTime,
        getPlayerCapDisplayTime,
        getSyntheticStageLyricsTime,
        isNowPlayingStageActive,
        isPlayerCapStageActive,
        lyrics,
        playerState,
        setCurrentLineIndex,
        setPlayerState,
        stageActiveEntryKind,
        stageLyricsClockRef,
        stageLyricsSession,
        syncNowPlayingClock,
        syncStageLyricsClock,
        lyricTimelineOffsetMs,
        lyricCurrentTime,
        isTransitionAudible,
        getDisplayElement,
    ]);

    useEffect(() => {
        animationFrameRef.current = requestAnimationFrame(updateLoop);
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [animationFrameRef, updateLoop]);
}
