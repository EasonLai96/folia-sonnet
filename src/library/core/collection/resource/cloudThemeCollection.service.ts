import type { SongResult } from '../../../../types';
import type { CollectionResource } from '../../shared/resource.contract';
import { createCollectionResourceState } from './collectionResourceState.service';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';

// src/library/core/services/cloudThemeCollection.ts
// 「AI 主题」那一屏的曲目资源：云端只给得出**歌名**，曲目得由客户端拿这些名字去自己登着的
// 平台上一首一首搜出来。所以它不是一次分页请求，而是「先占位、再逐条填」：
//
//  - 拉一段歌名，立刻按条数铺同样多的**占位行**（云端总数已知，先铺满整屏）；
//  - 然后一条一条去搜，搜到就把那一行换掉。
//
// 反过来（搜到一条往数组里 push 一条）每来一条整张表就重排一次，几百条下来就是一直在抖、
// 而且屏幕先被撑出一块空白再一路往下长 —— 占位行让列表高度从一开始就是最终高度。
// 占位行留着歌名，用户看得见「还有哪些在匹配」，而不是一片灰条。

/** 一次向云端要多少条歌名（约等于一屏多一点，铺满之后才开始搜）。 */
export const CLOUD_THEME_PAGE_SIZE = 60;
/** 同时搜几首。搜歌是网络往返，串行太慢；再高就只是把平台那边压得更狠。 */
const RESOLVE_CONCURRENCY = 2;

export type CloudThemeNameEntry = {
    songTitle: string;
    platform?: string;
    key?: string;
};

export type CloudThemeCollectionDeps = {
    /** 拉一段歌名。 */
    readNames: (page: { limit: number; offset: number }) => Promise<{ total: number; songs: CloudThemeNameEntry[] }>;
    /** 拿一个歌名去平台上搜，返回最像的那一首；搜不到返回 null（那一行会被去掉）。 */
    resolveSong: (songTitle: string, cacheKey?: string) => Promise<SongResult | null>;
};

/** 占位行还没有对应的曲目（渲染与播放都该让它不可点）。 */
export const CLOUD_THEME_PENDING_PREFIX = 'cloud-pending:';

export const isCloudThemePendingTrack = (song: unknown): boolean => (
    String((song as { id?: unknown } | null | undefined)?.id ?? '').startsWith(CLOUD_THEME_PENDING_PREFIX)
);

/**
 * 一行占位。
 *
 * 带上真歌名：占位期间用户看得见是哪首歌在匹配，而不是一行空壳。`id` 带前缀是为了
 * 让「这一行还没匹配上」这件事可判别（isCloudThemePendingTrack），也让替换时能按位置核对
 * （replaceTrackAt 认的是这一行的 key）。
 */
const pendingTrack = (index: number, songTitle: string): SongResult => ({
    id: `${CLOUD_THEME_PENDING_PREFIX}${index}`,
    name: songTitle,
    artists: [],
    album: { id: '', name: '' },
    durationMs: 0,
} as unknown as SongResult);

export const createCloudThemeCollectionResource = (
    key: string,
    deps: CloudThemeCollectionDeps,
): CollectionResource => {
    const state = createCollectionResourceState(key, 'cloud');
    // 每次重新开始加载 / 释放都 +1：上一轮的循环看到号变了就自己停下，
    // 不会在用户已经离开这一屏之后还接着往里塞歌。
    let generation = 0;
    let running = false;
    /** 下一页从哪里开始；取页失败时停在这里，等用户点「继续」。 */
    let nextOffset = 0;
    let total = 0;
    let disposed = false;

    const commitTracks = (next: SongResult[]) => state.set({ tracks: next }, 'urgent');

    const appendPage = (names: CloudThemeNameEntry[], from: number): number => {
        const before = state.get().tracks;
        const placeholders = names.map((entry, index) => pendingTrack(from + index, entry.songTitle));
        commitTracks([...before, ...placeholders]);
        return before.length;
    };

    /**
     * 把 names 这一段逐条搜出来，每搜到一条就把对应的占位行**原地换掉**。
     *
     * 搜不到的不在这里删：删一行会让后面所有行的下标往前挪一位，而别的 worker 正按
     * 下标换自己的那一行 —— 那样会把别人的行换错（甚至换成另一首歌）。所以整段搜完
     * 之后统一清一次剩下的占位行，那时下标不再有人在用。
     */
    const resolveRange = async (names: CloudThemeNameEntry[], from: number, ticket: number): Promise<void> => {
        let cursor = 0;
        const worker = async (): Promise<void> => {
            while (cursor < names.length) {
                if (disposed || ticket !== generation) return;
                const index = cursor;
                cursor += 1;
                const position = from + index;
                const found = await deps.resolveSong(names[index].songTitle, names[index].key).catch(() => null);
                if (disposed || ticket !== generation) return;
                const current = state.get().tracks;
                const expected = current[position];
                // 位置已经不是自己那一行（列表重来过）就别写了，免得把别人的行换掉。
                if (!expected || !isCloudThemePendingTrack(expected) || !found) continue;
                commitTracks(current.map((track, at) => (at === position ? found : track)));
            }
        };
        await Promise.all(Array.from({ length: Math.max(1, RESOLVE_CONCURRENCY) }, () => worker()));
        if (disposed || ticket !== generation) return;
        // 平台上搜不到（或搜失败）的名字：那一行留着点不动也播不了，整行拿掉。
        const current = state.get().tracks;
        if (current.some(isCloudThemePendingTrack)) {
            commitTracks(current.filter(track => !isCloudThemePendingTrack(track)));
        }
    };

    const load = async (ticket: number): Promise<void> => {
        if (running) return;
        running = true;
        state.set({ status: 'loading', sync: { status: 'syncing' }, error: null }, 'urgent');
        try {
            while (!disposed && ticket === generation) {
                const page = await deps.readNames({ limit: CLOUD_THEME_PAGE_SIZE, offset: nextOffset });
                if (disposed || ticket !== generation) return;
                total = Math.max(total, Number(page.total ?? 0) || 0);
                if (page.songs.length === 0) break;

                const from = state.get().tracks.length;
                appendPage(page.songs, from);
                /*
                 * 名字的游标与显示的下标**不是一回事**：搜不到的行会被整行拿掉，
                 * 列表比取过的名字短。还按下标算偏移就会把取过的名字再要一遍
                 * （于是屏幕上出现重复的歌）。
                 */
                nextOffset += page.songs.length;
                // 头一页铺完就先把状态放开：用户这时已经能看到满屏的歌名，
                // 后面几页接着补（右上角那颗转着的胶囊写着进度）。
                if (state.get().status !== 'ready') state.set({ status: 'ready' }, 'urgent');
                await resolveRange(page.songs, from, ticket);
                if (disposed || ticket !== generation) return;
                if (nextOffset >= total) break;
            }
            if (disposed || ticket !== generation) return;
            state.set({ status: 'ready', sync: { status: 'none' }, error: null }, 'urgent');
        } catch (error) {
            if (disposed || ticket !== generation) return;
            state.set({
                status: 'error',
                error: { kind: 'generic', message: error instanceof Error ? error.message : String(error) },
                sync: { status: 'interrupted', message: error instanceof Error ? error.message : String(error), offset: nextOffset },
            }, 'urgent');
        } finally {
            if (ticket === generation) running = false;
        }
    };

    return {
        key,
        kind: 'cloud',
        getSnapshot: state.get,
        subscribe: state.subscribe,
        ensure: () => {
            const snapshot = state.get();
            if (snapshot.status === 'loading' || snapshot.status === 'ready') return;
            generation += 1;
            nextOffset = 0;
            total = 0;
            commitTracks([]);
            void load(generation);
        },
        reload: () => {
            generation += 1;
            running = false;
            nextOffset = 0;
            total = 0;
            commitTracks([]);
            void load(generation);
        },
        /** 取下一页失败（或用户想接着往下看）时从中断处继续。 */
        resumeSync: () => {
            generation += 1;
            running = false;
            void load(generation);
        },
        canReuse: () => false,
        pause: () => {
            generation += 1;
            running = false;
        },
        dispose: () => {
            disposed = true;
            generation += 1;
            running = false;
            state.clear();
        },
        removeTracks: async (match) => {
            commitTracks(state.get().tracks.filter(track => !match(track)));
        },
        removeAt: (index, expectedKey) => {
            const current = state.get().tracks;
            if (!current[index] || getPlaybackSongKey(current[index]) !== expectedKey) return false;
            commitTracks(current.filter((_, position) => position !== index));
            return true;
        },
        replaceTrackAt: (index, expectedKey, next) => {
            const current = state.get().tracks;
            if (!current[index] || getPlaybackSongKey(current[index]) !== expectedKey) return false;
            commitTracks(current.map((track, position) => (position === index ? next : track)));
            return true;
        },
        replaceAll: async (loadTracks) => {
            commitTracks(await loadTracks());
            return true;
        },
    };
};
