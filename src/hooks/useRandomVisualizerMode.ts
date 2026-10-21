import { useEffect, useRef } from 'react';
import type { SongResult, VisualizerMode } from '../types';
import { VISUALIZER_REGISTRY } from '../components/visualizer/registry';
import { readDirectorSettings } from '../services/lyricDirector/state';
import { isBlockedDirectorMode } from '../services/lyricDirector/catalog';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';

// Applies a different registered lyric animation mode when the active track changes.
//
// Which ones it may pick is the same question the AI answers, with the same answer: a mode the
// listener has told the AI never to choose (Settings → AI 导演) is one they do not want to land on,
// whoever is doing the choosing — `still` looks broken rather than calm, `lumiere` buries the
// words. So the blocked list is read from the director's own settings rather than copied here,
// and it stays theirs to edit in one place.
export function useRandomVisualizerMode({
    currentSong,
    enabled,
    visualizerMode,
    setVisualizerMode,
}: {
    currentSong: SongResult | null;
    enabled: boolean;
    visualizerMode: VisualizerMode;
    setVisualizerMode: (mode: VisualizerMode, options?: { notify?: boolean }) => void;
}) {
    const observedSongIdRef = useRef<string | null>(null);
    const wasEnabledRef = useRef(enabled);

    useEffect(() => {
        const songId = currentSong ? getPlaybackSongKey(currentSong) : null;
        const wasEnabled = wasEnabledRef.current;
        wasEnabledRef.current = enabled;

        if (!enabled) {
            observedSongIdRef.current = songId;
            return;
        }

        if (!wasEnabled) {
            observedSongIdRef.current = songId;
            return;
        }

        if (songId === null) {
            return;
        }

        if (observedSongIdRef.current === null) {
            observedSongIdRef.current = songId;
            return;
        }

        if (observedSongIdRef.current === songId) {
            return;
        }

        observedSongIdRef.current = songId;
        const blocked = readDirectorSettings().blockedModes;
        const candidates = VISUALIZER_REGISTRY
            .map(entry => entry.mode)
            // (The one playing stays out as well: a "new" mode that is the same one reads as nothing happened.)
            .filter(mode => mode !== visualizerMode && !isBlockedDirectorMode(mode, blocked));
        const nextMode = candidates[Math.floor(Math.random() * candidates.length)] ?? visualizerMode;
        setVisualizerMode(nextMode, { notify: false });
    }, [currentSong, enabled, setVisualizerMode, visualizerMode]);
}
