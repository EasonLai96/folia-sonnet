import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { PlayerState } from '../../../../types';
import { setStatusMessage as setStatusMsg } from '../../../../stores/useStatusMessageStore';
import { setPlayerState } from '../../../../stores/usePlaybackStore';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { currentTime } from '../../../../stores/motionSignals';
import { markProgrammaticPause, playbackFade, type PlaybackFadeSettleReason } from '../../../../services/playbackFade';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import type { OnlineRecovery, OnlineRecoveryOptions } from '../restore/createOnlineRecoveryController';
import type { OnlineFailure } from '../../../../services/onlineMusic/failure/onlineFailureCase';
import { onlineFailureToast } from '../source/onlineFailureToast';

// src/components/app/playback/bridges/usePlaybackTransportController.ts

/**
 * 等音频上下文 resume 的上限（毫秒）。
 *
 * 这个 Promise **不保证会推进**（与 `audioWorklet.addModule()` 落在 suspended 的 context 上
 * 是同一类问题）：应用退到后台很久之后再点播放，它可能一直不落地。所以只等这么久。
 */
const AUDIO_CONTEXT_RESUME_GRACE_MS = 1200;

type UsePlaybackTransportControllerParams = {
    stageActiveEntryKind: string | null;
    isNowPlayingStageActive: boolean;
    audioRef: RefObject<HTMLAudioElement | null>;
    audioContextRef: MutableRefObject<AudioContext | null>;
    stageLyricsClockRef: MutableRefObject<{
        startTimeSec: number;
        endTimeSec: number;
        baseTimeSec: number;
        startedAtMs: number | null;
    }>;
    setupAudioAnalyzer: () => void;
    syncOutputGain: (targetVolume: number, smoothing?: number) => void;
    getTargetPlaybackVolume: () => number;
    shouldRefreshCurrentOnlineAudioSource: () => boolean;
    recoverOnlinePlaybackSource: (options: OnlineRecoveryOptions) => Promise<OnlineRecovery>;
    getSyntheticStageLyricsTime: () => number;
    syncStageLyricsClock: (timeSec: number, endTimeSec: number, nextPlayerState: PlayerState, startTimeSec?: number) => void;
    /**
     * Handles a pause that lands during an automix blend, returning true when it did.
     *
     * Mid-blend `audioRef` names the deck the next track is ARRIVING on, so the pause below would
     * stop a deck the listener cannot hear and leave the one they can hear playing on into the
     * next song - "I pressed pause and it jumped to the next track". This cancels the blend back
     * onto the deck still sounding the displayed track and pauses that, the same cancel a mid-blend
     * seek uses. Returns false (and the ordinary pause runs) when no blend is in flight.
     */
    pauseDuringTransition?: () => boolean;
    /** True while a blend is audible on the deck no control points at. Such a pause still needs the fade. */
    isTransitionAudible?: () => boolean;
};

// Owns play and pause transport behavior across main playback and Stage lyric-only playback.
export function usePlaybackTransportController({
    stageActiveEntryKind,
    isNowPlayingStageActive,
    audioRef,
    audioContextRef,
    stageLyricsClockRef,
    setupAudioAnalyzer,
    syncOutputGain,
    getTargetPlaybackVolume,
    shouldRefreshCurrentOnlineAudioSource,
    recoverOnlinePlaybackSource,
    getSyntheticStageLyricsTime,
    syncStageLyricsClock,
    pauseDuringTransition,
    isTransitionAudible,
}: UsePlaybackTransportControllerParams) {
    // Read here rather than passed in: store fields, a module-level motion signal, or i18n.
    const { t } = useTranslation();
    const activePlaybackContext = usePlaybackStore(state => state.activePlaybackContext);
    const audioSrc = usePlaybackStore(state => state.audioSrc);
    const duration = usePlaybackStore(state => state.duration);
    const transportRevision = useRef(0);
    const wantsPlayback = useRef(false);
    /**
     * 在后台按了播放、但音频上下文拉不起来时留下的「回到前台补一次」标记。
     *
     * 后台状态下 resume 不该硬撑（见 resumePlayback 里的判断），可用户那一下是按过的，
     * 不该就这么丢掉 —— 留个标记，等页面重新可见时补发。
     */
    const pendingForegroundResumeRef = useRef(false);
    useEffect(() => () => {
        transportRevision.current++;
        wantsPlayback.current = false;
        pendingForegroundResumeRef.current = false;
    }, []);

    const resumePlayback = useCallback(async () => {
        if (isNowPlayingStageActive) {
            return;
        }
        const revision = ++transportRevision.current;
        wantsPlayback.current = true;
        // 这一次是明确的播放意图，之前排队的「回到前台补一次」就不必再发。
        pendingForegroundResumeRef.current = false;

        if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
            const currentSyntheticTime = getSyntheticStageLyricsTime();
            syncStageLyricsClock(currentSyntheticTime, duration, PlayerState.PLAYING, stageLyricsClockRef.current.startTimeSec);
            currentTime.set(currentSyntheticTime);
            setPlayerState(PlayerState.PLAYING);
            return;
        }

        // A pause still fading out never reached the element, so there is nothing to start: turn
        // the fade around from the current gain instead of pressing play. A deck the export
        // controller already paused by hand takes the normal path below, which also retires the
        // pending pause.
        if (
            playbackFade.isFadingOut()
            && (!audioRef.current?.paused || isTransitionAudible?.())
            && playbackFade.cancelPendingPause()
        ) {
            setPlayerState(PlayerState.PLAYING);
            return;
        }

        const audio = audioRef.current;
        if (!audio) {
            return;
        }
        // A pause does not cancel source loading, but it must cancel an older
        // asynchronous resume. Store notifications alone cannot identify that
        // stale PLAYING event once a caller has already observed PAUSED.
        const source = usePlaybackStore.getState().audioSrc;
        const isSameSource = () => audioRef.current === audio && usePlaybackStore.getState().audioSrc === source;
        const isCurrent = () => revision === transportRevision.current && isSameSource();
        // A pending refresh can still supply the source after a pause. Its autoplay
        // decision follows the latest transport intent, including a later resume.
        const shouldAutoplay = () => wantsPlayback.current && isSameSource();

        setupAudioAnalyzer();
        /*
         * 上下文被挂起就要 resume，但**不能死等**。
         *
         * 应用退到后台很久之后再点播放（通知栏 / 锁屏 / 眼镜上的键），这个 Promise 有可能
         * 一直不落地。原来直接 await 它，整条播放就卡在这一行：没有声音，状态机也没动，
         * 而原生那边已经被 onPlay 切成在播 —— 状态栏、叠层的歌词照走。
         * 等回到前台，那句 await 才终于落地，于是「打开应用瞬间恢复」。
         *
         * 现在最多等 AUDIO_CONTEXT_RESUME_GRACE_MS，然后按上下文的真实状态决定。
         */
        const context = audioContextRef.current;
        if (context && context.state === 'suspended') {
            try {
                await Promise.race([
                    context.resume(),
                    new Promise<void>(resolve => {
                        setTimeout(resolve, AUDIO_CONTEXT_RESUME_GRACE_MS);
                    }),
                ]);
            } catch {
                // resume 被拒（页面被系统挂起、音频焦点被别的应用拿走）不是「不能播」的理由：
                // 元素本身照样能跑。到底播不播，下面按上下文的真实状态判断。
            }
            if (!isCurrent()) return;
            /*
             * 还是 suspended、而且现在在后台：这时候硬播只会是「有进度没声音」——
             * 元素在走，输出走的是那张挂起的音频图。宁可先不播（状态留在暂停，
             * 原生那边等不到 playing 会把歌词冻回去），回到前台再拉一次（见文件末尾的
             * visibilitychange）：用户在后台按的那一下不该变成一场假播放。
             */
            if (
                context.state === 'suspended'
                && typeof document !== 'undefined'
                && document.visibilityState === 'hidden'
            ) {
                pendingForegroundResumeRef.current = true;
                setPlayerState(PlayerState.PAUSED);
                return;
            }
        }
        if (!isCurrent()) return;

        syncOutputGain(getTargetPlaybackVolume(), 0);
        // A failed refresh of an address that ran out still falls back to the old one below, as before.
        // Its reason is kept so that, should that play fail too, the message names it.
        let refreshFailure: OnlineFailure | undefined;
        if (shouldRefreshCurrentOnlineAudioSource()) {
            const refreshed = await recoverOnlinePlaybackSource({
                failedSrc: audio.currentSrc || audioSrc,
                resumeAt: audio.currentTime,
                autoplay: true,
                shouldAutoplay,
            });

            if (!isCurrent() || refreshed.recovered || refreshed.stale) {
                return;
            }
            refreshFailure = refreshed.failure;
        }

        // Silent first, ramped up once play() has really started. Null when the fade is off or
        // there is no Web Audio graph, and the two calls below are then no-ops. Only for an element
        // that is actually stopped: pressing play on one that is already sounding must not dip it.
        const fadeToken = audio.paused || audio.ended
            ? playbackFade.prepareFadeIn()
            : null;
        try {
            await audio.play();
            if (!isCurrent()) { playbackFade.abortFadeIn(fadeToken); return; }
            playbackFade.runFadeIn(fadeToken);
            setPlayerState(PlayerState.PLAYING);
        } catch (error) {
            playbackFade.abortFadeIn(fadeToken);
            if (!isCurrent()) return;
            const recovery = await recoverOnlinePlaybackSource({
                failedSrc: audio.currentSrc || audioSrc,
                resumeAt: audio.currentTime,
                autoplay: true,
                shouldAutoplay,
            });

            if (!isCurrent() || recovery.recovered || recovery.stale) {
                return;
            }

            if (!audio.paused && !audio.ended) {
                setPlayerState(PlayerState.PLAYING);
                return;
            }

            if (error instanceof DOMException && error.name === 'NotAllowedError') {
                setStatusMsg({ type: 'info', text: t('status.clickToPlay') });
                setPlayerState(PlayerState.PAUSED);
                return;
            }

            // An online song whose address was asked for again and refused says why; so does one whose
            // address ran out and could not be had again, where the old one failed to play too. A toast
            // that stays (a countdown to the next song) is not covered by this one.
            const shown = recovery.failure ?? refreshFailure;
            const said = shown ? onlineFailureToast(shown, t) : { type: 'error' as const, text: t('status.playbackError') };
            setStatusMsg(prev => (prev?.persistent ? prev : said));
            setPlayerState(PlayerState.PAUSED);
            throw error;
        }
    }, [activePlaybackContext, audioContextRef, audioRef, audioSrc, currentTime, duration, getSyntheticStageLyricsTime, getTargetPlaybackVolume, isNowPlayingStageActive, isTransitionAudible, recoverOnlinePlaybackSource, setPlayerState, setStatusMsg, setupAudioAnalyzer, shouldRefreshCurrentOnlineAudioSource, stageActiveEntryKind, stageLyricsClockRef, syncOutputGain, syncStageLyricsClock, t]);

    const pausePlayback = useCallback(() => {
        if (isNowPlayingStageActive) {
            return;
        }
        transportRevision.current++;
        wantsPlayback.current = false;
        // 用户自己按了暂停，那一下排队的补播就该作废。
        pendingForegroundResumeRef.current = false;

        if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
            const currentSyntheticTime = getSyntheticStageLyricsTime();
            syncStageLyricsClock(currentSyntheticTime, duration, PlayerState.PAUSED, stageLyricsClockRef.current.startTimeSec);
            currentTime.set(currentSyntheticTime);
            setPlayerState(PlayerState.PAUSED);
            return;
        }

        const readCurrentSongKey = () => {
            const song = usePlaybackStore.getState().currentSong;
            return song ? getPlaybackSongKey(song) : null;
        };
        const songKeyAtPress = readCurrentSongKey();

        // Before the element is touched, because mid-blend `audioRef` is the wrong element to touch:
        // it names the deck the next track is arriving on. The cancel pauses the deck that is
        // actually sounding, so there is nothing left here but to settle the transport.
        // Returns whether a pause happened, so the caller knows to settle the transport.
        const settlePause = (reason: PlaybackFadeSettleReason = 'elapsed'): boolean => {
            if (pauseDuringTransition?.()) {
                // The cancel left the audio ref on the deck it just paused, and that deck's pause
                // event is as much a flush's as the plain path's below.
                if (reason === 'flushed' && audioRef.current) {
                    markProgrammaticPause(audioRef.current);
                }
                syncOutputGain(getTargetPlaybackVolume(), 0);
                return true;
            }

            if (!audioRef.current) {
                return false;
            }

            // A flush happens while a track change is in flight: its pause event arrives after the
            // new song has set its play intent, so it is marked and ignored by the pause handler.
            if (reason === 'flushed' && !audioRef.current.paused && !audioRef.current.ended) {
                markProgrammaticPause(audioRef.current);
            }
            audioRef.current.pause();
            syncOutputGain(getTargetPlaybackVolume(), 0);
            return true;
        };

        // Fade first, pause when the ramp is done. The whole of settlePause is deferred, so a
        // blend that is armed or running at that moment is still cancelled onto the right deck.
        // The transport reads PAUSED straight away; the element follows ~200ms later. Nothing to
        // fade (already paused, feature off, no Web Audio) pauses directly as before.
        const transitionAtPress = Boolean(isTransitionAudible?.());
        const isSounding = Boolean(audioRef.current && !audioRef.current.paused) || transitionAtPress;
        // Backstop for song changes that bypass playSong's own flush: a different song by the time
        // the fade ends means the pause was meant for the old one, and the new one must keep playing.
        // Not applied during a blend: an armed blend has already asked for the next song, so
        // `currentSong` moves to it a moment after the press without that being a change of mind -
        // and the pause still has to cancel the blend back onto the song the listener was hearing.
        const settleDeferredPause = (reason: PlaybackFadeSettleReason) => {
            const duringBlend = transitionAtPress || Boolean(isTransitionAudible?.());
            if (!duringBlend && readCurrentSongKey() !== songKeyAtPress) return;
            settlePause(reason);
        };
        if (isSounding && playbackFade.fadeOutThen(settleDeferredPause)) {
            setPlayerState(PlayerState.PAUSED);
            return;
        }

        if (settlePause()) {
            setPlayerState(PlayerState.PAUSED);
        }
    }, [activePlaybackContext, audioRef, audioSrc, currentTime, duration, getSyntheticStageLyricsTime, getTargetPlaybackVolume, isNowPlayingStageActive, isTransitionAudible, pauseDuringTransition, setPlayerState, stageActiveEntryKind, stageLyricsClockRef, syncOutputGain, syncStageLyricsClock]);

    /*
     * 回到前台补一次。
     *
     * 在后台按播放时音频上下文不一定能被唤醒（页面被挂起、音频焦点在别处），resumePlayback
     * 那时只留下标记、状态停在暂停 —— 为的是不出现「元素在走、声音没有」的假播放。
     * 页面重新可见（真的有人在看、系统也把页面放回来了）就把那一下补上。
     * 标记在 resumePlayback 一开始就会被清掉，所以在里面再设一次也自洽。
     */
    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        const onVisibilityChange = () => {
            if (document.visibilityState !== 'visible') return;
            if (!pendingForegroundResumeRef.current) return;
            pendingForegroundResumeRef.current = false;
            void resumePlayback();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, [resumePlayback]);

    return {
        resumePlayback,
        pausePlayback,
    };
}
