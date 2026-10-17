import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import {
    createCloudThemeCollectionResource,
    isCloudThemePendingTrack,
    type CloudThemeCollectionDeps,
    type CloudThemeNameEntry,
} from '@/library/core/collection/resource/cloudThemeCollection.service';

// test/unit/library/core/cloudThemeCollection.test.ts
// 「AI 主题」那一屏的懒加载：云端只给歌名，曲目要客户端一首一首搜出来。
// 这里钉的是**加载形状**，不是数据内容：
//
//   1. 先把整屏铺满占位行（条数 == 本页歌名数），之后只替换、不增删 ——
//      反过来（搜到一条 push 一条）每来一条整张表重排一次，屏幕上先空白后一路往下长，很卡；
//   2. 搜不到的整行拿掉，且不能把别的行换错（并发 worker 各自按下标写，中途删行会带偏）；
//   3. 下一页的 offset 按**名字数**走，不按下标 —— 删过行之后两者不是一回事；
//   4. 离开这一屏（pause）之后不再取下一页、也不再往里插歌。

const entryOf = (index: number): CloudThemeNameEntry => ({
    songTitle: `Song ${index}`,
    platform: 'netease',
    key: `k-${index}`,
});

const songOf = (title: string): SongResult => ({
    id: `r-${title}`,
    name: title,
    artists: [],
    album: { id: '', name: '' },
    durationMs: 1,
} as unknown as SongResult);

const titlesOf = (tracks: SongResult[]) => tracks.map(track => String(track.name));
const idsOf = (tracks: SongResult[]) => tracks.map(track => String(track.id));

type Gate = {
    title: string;
    settled: boolean;
    resolve: (value: SongResult | null) => void;
    promise: Promise<SongResult | null>;
};

/** 让排队的微任务（含多层 await）全部跑完。 */
const settle = async () => {
    for (let i = 0; i < 80; i += 1) await Promise.resolve();
};

type Harness = {
    resource: ReturnType<typeof createCloudThemeCollectionResource>;
    offsets: number[];
    gates: Gate[];
    /** 把当前所有还没落定的搜索按 mapper 落定；新冒出来的继续落定，直到没有为止。 */
    drain: (mapper: (title: string) => SongResult | null) => Promise<void>;
};

const createHarness = (
    pages: CloudThemeNameEntry[][],
    options: { total?: number; failAtOffset?: number } = {},
): Harness => {
    const pageSize = 2;
    const offsets: number[] = [];
    const gates: Gate[] = [];
    const total = options.total ?? pages.flat().length;

    const readNames = async ({ offset }: { limit: number; offset: number }): Promise<{ total: number; songs: CloudThemeNameEntry[] }> => {
        offsets.push(offset);
        if (options.failAtOffset === offset) throw new Error('cloud down');
        return { total, songs: pages[Math.floor(offset / pageSize)] ?? [] };
    };

    const resolveSong = (songTitle: string): Promise<SongResult | null> => {
        const pending: Gate = {
            title: songTitle,
            settled: false,
            promise: Promise.resolve(null),
            resolve: () => {},
        };
        pending.promise = new Promise<SongResult | null>((res) => {
            pending.resolve = (value) => {
                if (pending.settled) return;
                pending.settled = true;
                res(value);
            };
        });
        gates.push(pending);
        return pending.promise;
    };

    const deps: CloudThemeCollectionDeps = { readNames, resolveSong };
    const resource = createCloudThemeCollectionResource('cloud:ai-theme', deps);

    const drain = async (mapper: (title: string) => SongResult | null): Promise<void> => {
        for (let round = 0; round < 400; round += 1) {
            await settle();
            const pending = gates.filter(item => !item.settled);
            if (pending.length === 0) return;
            pending.forEach(item => item.resolve(mapper(item.title)));
        }
    };

    return { resource, offsets, gates, drain };
};

const start = (harness: Harness) => {
    harness.resource.ensure({} as never, {});
};

describe('cloudThemeCollection', () => {
    it('fills the screen with placeholders before any song is resolved', async () => {
        const harness = createHarness([[entryOf(0), entryOf(1), entryOf(2)]]);
        start(harness);
        await settle();

        const snapshot = harness.resource.getSnapshot();
        // 关键是「先占位」：一条都还没搜出来，屏幕上已经是满的三行。
        expect(snapshot.tracks).toHaveLength(3);
        expect(snapshot.tracks.every(isCloudThemePendingTrack)).toBe(true);
        expect(titlesOf(snapshot.tracks)).toEqual(['Song 0', 'Song 1', 'Song 2']);
        // 头一页铺完就先放开：用户这时已经看得见整屏歌名，后面接着补。
        expect(snapshot.status).toBe('ready');

        await harness.drain(title => songOf(title));

        // 之后只替换、不增删：行数一直是 3。
        expect(harness.resource.getSnapshot().tracks).toHaveLength(3);
        expect(idsOf(harness.resource.getSnapshot().tracks)).toEqual(['r-Song 0', 'r-Song 1', 'r-Song 2']);
    });

    it('drops the whole row when the platform has no match', async () => {
        const harness = createHarness([[entryOf(0), entryOf(1), entryOf(2)]]);
        start(harness);
        await harness.drain(title => (title === 'Song 1' ? null : songOf(title)));

        const tracks = harness.resource.getSnapshot().tracks;
        expect(idsOf(tracks)).toEqual(['r-Song 0', 'r-Song 2']);
        // 不能留下没匹配上的占位行（点不动也播不了）。
        expect(tracks.some(isCloudThemePendingTrack)).toBe(false);
    });

    it('asks for the next page by name offset, not by row index', async () => {
        // 第一页 3 条里 Song 1 搜不到 → 那一行被拿掉，列表只剩 2 行。
        // 下一页必须从 offset 3（名字数）开始；按行号（2）会把 Song 2 再要一遍。
        const harness = createHarness(
            [[entryOf(0), entryOf(1), entryOf(2)], [entryOf(3), entryOf(4)]],
            { total: 5 },
        );
        start(harness);
        await harness.drain(title => (title === 'Song 1' ? null : songOf(title)));

        expect(harness.offsets).toEqual([0, 3]);
        expect(idsOf(harness.resource.getSnapshot().tracks)).toEqual(['r-Song 0', 'r-Song 2', 'r-Song 3', 'r-Song 4']);
    });

    it('stops asking and stops filling after the screen is left', async () => {
        const harness = createHarness([[entryOf(0), entryOf(1)], [entryOf(2), entryOf(3)]], { total: 4 });
        start(harness);
        await settle();

        expect(harness.resource.getSnapshot().tracks).toHaveLength(2);

        // 用户滑走了：正在搜的那些即便回来了也不许再往里插。
        harness.resource.pause();
        await harness.drain(title => songOf(title));

        expect(harness.offsets).toEqual([0]);
        const tracks = harness.resource.getSnapshot().tracks;
        expect(idsOf(tracks)).toEqual(['cloud-pending:0', 'cloud-pending:1']);
    });

    it('stops after dispose', async () => {
        const harness = createHarness([[entryOf(0), entryOf(1)], [entryOf(2), entryOf(3)]], { total: 4 });
        start(harness);
        await settle();
        harness.resource.dispose();
        await harness.drain(title => songOf(title));

        expect(harness.offsets).toEqual([0]);
    });

    it('marks the run as interrupted at the offset it stopped at', async () => {
        const harness = createHarness([[entryOf(0), entryOf(1)], [entryOf(2), entryOf(3)]], {
            total: 4,
            failAtOffset: 2,
        });
        start(harness);
        await harness.drain(title => songOf(title));

        const snapshot = harness.resource.getSnapshot();
        expect(snapshot.status).toBe('error');
        expect(snapshot.sync).toMatchObject({ status: 'interrupted', offset: 2 });
        // 已经铺出来的两行留着，用户看得见前面那一屏。
        expect(idsOf(snapshot.tracks)).toEqual(['r-Song 0', 'r-Song 1']);
    });

    it('reloads from the first name again', async () => {
        const harness = createHarness([[entryOf(0), entryOf(1)], [entryOf(2), entryOf(3)]], { total: 4 });
        start(harness);
        await harness.drain(title => songOf(title));
        expect(idsOf(harness.resource.getSnapshot().tracks)).toEqual(['r-Song 0', 'r-Song 1', 'r-Song 2', 'r-Song 3']);

        harness.resource.reload();
        await harness.drain(title => songOf(title));

        // 重新加载：清掉重来，offset 从 0 再走一遍。
        expect(harness.offsets).toEqual([0, 2, 0, 2]);
        expect(idsOf(harness.resource.getSnapshot().tracks)).toEqual(['r-Song 0', 'r-Song 1', 'r-Song 2', 'r-Song 3']);
    });
});
