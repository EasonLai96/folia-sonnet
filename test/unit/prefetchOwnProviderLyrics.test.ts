import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../src/types';

// test/unit/prefetchOwnProviderLyrics.test.ts
// #160（预取那一路）：原平台歌词接口回了空、自动匹配的胜者仍是原平台时，
// 预取缓存不能把「没有歌词」存下来 —— 前台播放直接读这份缓存，用户看到的就是空歌词。
// 与 onlinePlayback.ts 是同一个判断，两处都要挡。

const lyricsMock = vi.hoisted(() => vi.fn());
const autoMatchMock = vi.hoisted(() => vi.fn());
const loadOnlineLyricsStateMock = vi.hoisted(() => vi.fn());
const saveOnlineLyricsStateMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        getLyrics: lyricsMock,
        getAlternateArtistName: vi.fn(async () => null),
        levelOfAudioSource: () => undefined,
        isPreviewAudioSource: () => false,
        canPlaySong: () => true,
        getAudioSource: vi.fn(async () => null),
        getSongDetail: vi.fn(async () => null),
        resolveAudioQuality: (_p: string, q: string) => q,
    },
}));
vi.mock('@/utils/lyrics/autoMatchBestLyric', () => ({
    autoMatchBestLyric: autoMatchMock,
}));
vi.mock('@/utils/onlineLyricsState', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/utils/onlineLyricsState')>()),
    loadOnlineLyricsState: loadOnlineLyricsStateMock,
    saveOnlineLyricsState: saveOnlineLyricsStateMock,
}));

const { prefetchNearbySongs, getPrefetchedData, clearPrefetchRuntime } = await import('@/services/prefetchService');

const song = {
    id: '3001',
    name: '提瓦特民谣',
    durationMs: 200_000,
    artists: [{ id: 1, name: '某歌手' }],
    album: { id: 2, name: '某专辑' },
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: '3001' },
} as unknown as SongResult;

// 预取按「当前歌之后的几首」推进，当前歌自己不进预取队列 —— 所以队列里要有两首。
const playingNow = {
    ...song,
    id: '3000',
    name: '正在播的这首',
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: '3000' },
} as unknown as SongResult;

describe('预取也认得「原平台自己的歌词」', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearPrefetchRuntime();
        loadOnlineLyricsStateMock.mockResolvedValue(null);
        saveOnlineLyricsStateMock.mockResolvedValue(undefined);
        // 预取是用 requestIdleCallback 排队的；测试环境没有它，给一个立刻就执行的版本，
        // 这样 await prefetchNearbySongs 之后歌词已经在缓存里。
        const runNow = (run: () => void) => { run(); };
        vi.stubGlobal('window', { requestIdleCallback: runNow });
        vi.stubGlobal('requestIdleCallback', runNow);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps the matched lyrics instead of caching an empty set', async () => {
        // 网易云对这首歌回空。
        lyricsMock.mockResolvedValue({
            lyrics: null, mainText: null, wordByWordText: null, translationText: null,
            isPureMusic: false, chorusRanges: [],
        });
        const matched = {
            lines: [{ startTime: 0, endTime: 1, fullText: 'matched line', words: [] }],
            isWordByWord: false,
        };
        // 自动匹配的胜者仍是网易云自己。
        autoMatchMock.mockResolvedValue({
            lyrics: matched,
            source: 'netease',
            id: '3001',
            song,
        });

        await prefetchNearbySongs(playingNow, [playingNow, song], 'high');

        // 预取是按 idle 回调异步排队的，断言前等它真的跑完。
        await vi.waitFor(() => {
            expect(getPrefetchedData(song)).not.toBeNull();
        }, { timeout: 5000 });

        const data = getPrefetchedData(song);
        expect(data?.lyrics).toBeTruthy();
        expect(data?.lyrics?.lines?.[0]?.fullText).toBe('matched line');
    });
});
