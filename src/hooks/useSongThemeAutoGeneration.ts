import { useEffect, useRef } from 'react';
import type { GenerateAIThemeOptions, GenerateAIThemeResult } from './useThemeController';
import type { LyricData, SongResult } from '../types';
import type { ThemeGenerationSource } from '../services/themePreferences';
import {
    getSongThemeAutoGenerationKey,
    hasSongThemePromptSource,
    isSongThemeGenerationStillCurrent,
    shouldRequestSongThemeAutoGeneration,
} from '../utils/songThemeAutoGeneration';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { isPlaybackInterfaceHidden } from '../services/playbackRecovery/backgroundFailureNotice';

// src/hooks/useSongThemeAutoGeneration.ts
// Coordinates delayed AI theme generation for the real current playback song.

type GenerateAITheme = (
    lyrics: LyricData | null,
    currentSong: SongResult | null,
    options?: GenerateAIThemeOptions,
) => Promise<GenerateAIThemeResult>;

type UseSongThemeAutoGenerationParams = {

    enabled: boolean;
    isLyricsLoading: boolean;
    // 'cover' generates from the artwork alone, so it does not wait for a lyric prompt source.
    themeGenerationSource: ThemeGenerationSource;
    generateAITheme: GenerateAITheme;
};

const AUTO_GENERATE_DELAY_MS = 650;

export function useSongThemeAutoGeneration({
    enabled,
    isLyricsLoading,
    themeGenerationSource,
    generateAITheme,
}: UseSongThemeAutoGenerationParams) {
    const currentSong = usePlaybackStore(state => state.currentSong);
    const lyrics = usePlaybackStore(state => state.lyrics);

    const requiresPromptSource = themeGenerationSource !== 'cover';
    const latestSongKeyRef = useRef<string | null>(null);
    const latestEnabledRef = useRef(enabled);
    const latestGenerationInputRef = useRef({ currentSong, lyrics });
    const attemptedSongKeysRef = useRef(new Set<string>());
    const generateAIThemeRef = useRef(generateAITheme);
    const songKey = getSongThemeAutoGenerationKey(currentSong);
    const hasPromptSource = currentSong
        ? hasSongThemePromptSource(currentSong, lyrics)
        : false;

    useEffect(() => {
        generateAIThemeRef.current = generateAITheme;
    }, [generateAITheme]);

    useEffect(() => {
        latestGenerationInputRef.current = { currentSong, lyrics };
    }, [currentSong, lyrics]);

    useEffect(() => {
        latestEnabledRef.current = enabled;
    }, [enabled]);

    useEffect(() => {
        latestSongKeyRef.current = songKey;
    }, [songKey]);

    useEffect(() => {
        const scheduledInput = latestGenerationInputRef.current;
        const scheduledSong = scheduledInput.currentSong;
        if (!scheduledSong || !songKey) {
            return;
        }

        if (!shouldRequestSongThemeAutoGeneration({
            enabled,
            currentSong: scheduledSong,
            lyrics: scheduledInput.lyrics,
            isLyricsLoading,
            hasAttempted: attemptedSongKeysRef.current.has(songKey),
            hasCachedTheme: false,
            requiresPromptSource,
        })) {
            return;
        }

        const targetSongKey = songKey;
        let cancelled = false;

        const attempt = async () => {
            if (cancelled || !isSongThemeGenerationStillCurrent({
                latestSongKey: latestSongKeyRef.current,
                targetSongKey,
                enabled: latestEnabledRef.current,
            })) {
                return;
            }

            const latestInput = latestGenerationInputRef.current;
            const latestSong = latestInput.currentSong;
            if (!latestSong) {
                return;
            }

            if (cancelled || !isSongThemeGenerationStillCurrent({
                latestSongKey: latestSongKeyRef.current,
                targetSongKey,
                enabled: latestEnabledRef.current,
            })) {
                return;
            }
            if (!shouldRequestSongThemeAutoGeneration({
                enabled: latestEnabledRef.current,
                currentSong: latestSong,
                lyrics: latestInput.lyrics,
                isLyricsLoading: false,
                hasAttempted: attemptedSongKeysRef.current.has(targetSongKey),
                /* 生成结果只存云端：命中时 generateThemeFromLyrics 已经直接返回。 */
                hasCachedTheme: false,
                requiresPromptSource,
            })) {
                /*
                 * 「这次没发起」**不能**记成「这首歌试过了」。
                 *
                 * 以前在这里也 add 一次，于是一首歌词晚到的歌会被永久放弃：650ms 那一拍
                 * 歌词还没回来（在线歌词要一次网络往返，后台尤其慢），判据不通过就打上
                 * 「已尝试」；等歌词真正到了，`hasPromptSource` 变了、effect 重跑，却被
                 * `hasAttempted` 直接挡回去 —— **这首歌本次会话再也不会自动生成**，云缓存
                 * 也就一次都没问过。这正是「后台播下一首，有概率不拉缓存」的来源。
                 *
                 * 只有真发起了生成才该记：那才是「别给同一首歌重复烧一次」要挡的事。
                 */
                return;
            }

            attemptedSongKeysRef.current.add(targetSongKey);
            await generateAIThemeRef.current(latestInput.lyrics, latestSong, {
                source: 'auto',
                shouldApply: () => isSongThemeGenerationStillCurrent({
                    latestSongKey: latestSongKeyRef.current,
                    targetSongKey,
                    enabled: latestEnabledRef.current,
                }),
            });
        };

        /*
         * 后台不排倒计时。
         *
         * 界面没人看的时候 WebView 的 `setTimeout` 会被节流（重的直接冻住）：650ms 这一拍
         * 可能要等上一分钟，而这一分钟里多半又切了一首歌 —— effect 的 cleanup 会把那个
         * 定时器清掉，于是这首歌的生成**一次都没发起过**。前台那 650ms 是为了等歌词、
         * 少打一次模型；后台没人看着，再等 650ms 没有任何意义，条件到了就当场发起。
         *
         * 这条与播放失败那条纪律是同一件事：后台不要依赖 JS 定时器去做用户会察觉的事。
         */
        let timeoutId: number | null = null;
        if (isPlaybackInterfaceHidden()) {
            void attempt();
        } else {
            timeoutId = window.setTimeout(() => {
                void attempt();
            }, AUTO_GENERATE_DELAY_MS);
        }

        return () => {
            cancelled = true;
            if (timeoutId !== null) window.clearTimeout(timeoutId);
        };
    }, [enabled, hasPromptSource, isLyricsLoading, requiresPromptSource, songKey]);
}
