// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSongThemeAutoGeneration } from '@/hooks/useSongThemeAutoGeneration';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import type { LyricData, SongResult } from '@/types';

// test/unit/hooks/useSongThemeAutoGeneration.test.ts
// 切歌之后的自动生成到底有没有发起 —— 「后台播着，下一首却没去问云缓存」就在这一段。
//
// 这段逻辑靠一个 650ms 的 `setTimeout` 起跳。界面没人看的时候 WebView 会把定时器
// 节流甚至冻住：那一拍可能要等上一分钟，而这一分钟里多半又切了一首歌，effect 的
// cleanup 会把那个定时器**直接清掉** —— 于是这首歌的生成一次都没发起过，云缓存
// 也就一次都没问。后台改成条件到了就当场发起，不再赌定时器会不会按时响。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const buildSong = (id: string): SongResult => ({
    id,
    name: `song-${id}`,
    artists: [{ id: `artist-${id}`, name: 'artist' }],
    album: { id: `album-${id}`, name: 'album' },
    source: 'local',
}) as unknown as SongResult;

const buildLyrics = (text: string): LyricData => ({
    lines: [{ fullText: text, words: [], time: 0 }],
}) as unknown as LyricData;

type Call = { songId: string | null };

let container: HTMLDivElement;
let root: Root;
let calls: Call[];
let generateAITheme: ReturnType<typeof vi.fn>;

const Probe = ({ enabled, isLyricsLoading }: { enabled: boolean; isLyricsLoading: boolean }) => {
    useSongThemeAutoGeneration({
        enabled,
        isLyricsLoading,
        themeGenerationSource: 'ai',
        generateAITheme,
    });
    return null;
};

const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (hidden ? 'hidden' : 'visible'),
    });
};

const setPlayback = (song: SongResult | null, lyrics: LyricData | null) => {
    act(() => {
        usePlaybackStore.setState({ currentSong: song, lyrics });
    });
};

/** async 的 attempt 里没有 await，但函数自身要过一次微任务才走到发起那一步。 */
const flush = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
};

const render = async (enabled: boolean, isLyricsLoading: boolean) => {
    await act(async () => {
        root.render(createElement(Probe, { enabled, isLyricsLoading }));
    });
    await flush();
};

const advance = async (ms: number) => {
    await act(async () => {
        vi.advanceTimersByTime(ms);
        await Promise.resolve();
        await Promise.resolve();
    });
};

beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    generateAITheme = vi.fn(async (lyrics: LyricData | null, song: SongResult | null) => {
        calls.push({ songId: song?.id ?? null });
        return { status: 'generated', applied: true } as const;
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    setHidden(false);
    setPlayback(null, null);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setPlayback(null, null);
    vi.useRealTimers();
});

describe('useSongThemeAutoGeneration', () => {
    it('waits out the settle delay while the page is visible', async () => {
        setPlayback(buildSong('a'), buildLyrics('la la la'));
        await render(true, false);

        expect(calls).toEqual([]);
        await advance(700);
        expect(calls).toEqual([{ songId: 'a' }]);
    });

    /*
     * 这条就是后台丢歌的那一段：不看定时器还有没有机会响，条件到了就当场发起。
     */
    it('starts right away when nobody is watching, without waiting for the timer', async () => {
        setHidden(true);
        setPlayback(buildSong('a'), buildLyrics('la la la'));
        await render(true, false);

        expect(calls).toEqual([{ songId: 'a' }]);
    });

    /*
     * 连着切歌时最容易丢：前台那 650ms 还没到，下一首已经把上一首的定时器清掉了。
     * 后台不再排定时器，于是每一首都真的发起了。
     */
    it('keeps every song when the next one arrives before the delay would have fired', async () => {
        setHidden(true);
        setPlayback(buildSong('a'), buildLyrics('first'));
        await render(true, false);

        setPlayback(buildSong('b'), buildLyrics('second'));
        await flush();
        setPlayback(buildSong('c'), buildLyrics('third'));
        await flush();

        expect(calls).toEqual([{ songId: 'a' }, { songId: 'b' }, { songId: 'c' }]);
    });

    it('does nothing while the switch is off', async () => {
        setHidden(true);
        setPlayback(buildSong('a'), buildLyrics('la la la'));
        await render(false, false);

        await advance(2000);
        expect(calls).toEqual([]);
    });

    /*
     * 歌词还在路上时不该把这首歌记成「试过了」—— 记了的话，等歌词真正回来，
     * effect 重跑也会被 `hasAttempted` 直接挡回去，这首歌本次会话再也不会生成。
     */
    it('does not burn the song when the lyrics have not arrived yet', async () => {
        setHidden(true);
        setPlayback(buildSong('a'), null);
        await render(true, false);

        expect(calls).toEqual([]);

        /* 歌词到了：自动触发应当照常补上，而不是被上一次的放弃挡住。 */
        setPlayback(buildSong('a'), buildLyrics('late but here'));
        await flush();

        expect(calls).toEqual([{ songId: 'a' }]);
    });

    it('asks only once per song', async () => {
        setHidden(true);
        setPlayback(buildSong('a'), buildLyrics('la la la'));
        await render(true, false);
        await advance(2000);

        expect(calls).toEqual([{ songId: 'a' }]);
    });
});
