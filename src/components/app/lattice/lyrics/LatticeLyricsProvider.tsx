import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { LatticeLyricSource } from './types';

// src/components/app/lattice/lyrics/LatticeLyricsProvider.tsx
export type LatticeLyricContext = LatticeLyricSource & { songKey: string };
const Context = createContext<LatticeLyricContext | null>(null);
export const useLatticeLyrics = () => useContext(Context);

export default function LatticeLyricsProvider({ source, songKey, children }: {
    source: LatticeLyricSource; songKey: string; children: ReactNode;
}) {
    // Select explicitly: the source may structurally contain global font scales and player-only showText.
    const { currentTime, currentLineIndex, lines, theme, subtitleTheme, showSubtitleTranslation,
        hideTranslationSubtitle, subtitleContentMode, paused, staticMode } = source;
    const value = useMemo(() => ({ currentTime, currentLineIndex, lines, theme, subtitleTheme,
        showSubtitleTranslation, hideTranslationSubtitle, subtitleContentMode, paused, staticMode, songKey }),
    [currentTime, currentLineIndex, lines, theme, subtitleTheme, showSubtitleTranslation,
        hideTranslationSubtitle, subtitleContentMode, paused, staticMode, songKey]);
    return <Context.Provider value={value}>{children}</Context.Provider>;
}
