import type { SongResult, UnifiedSong } from '../../types';
import type { OmniProviderId } from '../../types/onlineMusic';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { announceLocalCoverReady } from '../localCoverReadyEvent';

// src/services/onlineMusic/onlineCoverFallback.ts
// 缺封面的歌，按名字去网络平台搜一张来顶。
//
// 起因是飞牛：它只是把 NAS 上的文件读成曲库，文件没嵌封面、目录里没有 cover.jpg，
// 接口就给不出 coverId —— 一整墙磁贴是占位图，播放页背景、控制面板背景、莫奈背景
// 也一起空着（它们取的都是同一张封面）。飞牛只负责出声，元数据谁有就用谁的：
// 拿歌名去别的平台搜一次，把匹配最高的那条的封面借过来。
//
// 为什么挂在**取封面**那一处、而不是某一个 provider 的出口：网格布局、墙面布局、队列
// 磁贴、控制面板、几处背景，全都经过 `getSongCoverUrl` 这一个入口。只在 provider 出口
// 补，队列里那份「建队时烤进去的快照」和就地算出来的那些背景照样是空的。
//
// 三条约束：
// 1. 结果一律缓存，**搜不到也缓存**（存空串）—— 否则每次渲染都要搜一遍；
// 2. 有预算 + 串行：搜索请求同样过那条共用的桥，一次并发几十个会把别的平台又挤一遍；
// 3. 拿到之后要**广播**：封面是异步来的，而队列磁贴的 `album.coverUrl` 是建队那一刻
//    烤进去的快照，不通知它就永远看不见（见 localCoverReadyEvent 里的说明）。

/** 按这个顺序借封面：网易的曲库最全，酷狗兜底。 */
const FALLBACK_PROVIDERS: OmniProviderId[] = ['netease', 'qq', 'kugou'];

/** 一次会话最多搜这么多次（命中缓存不算）。 */
const SEARCH_BUDGET = 120;

/** 一个列表一次最多同步等这么多首，剩下的交给异步那一路。 */
const PER_PAGE_LIMIT = 6;

const coverCache = new Map<string, string>();
const pendingKeys = new Set<string>();
let budget = SEARCH_BUDGET;

/** 串行闸门：渲染时一次会撞进来十几首，不能让它们同时去搜。 */
let chain: Promise<unknown> = Promise.resolve();

const cacheKey = (name: string, artist: string): string => `${name} ${artist}`;

/**
 * 搜到的结果是不是同一首歌。
 * 平台会给出一堆同名不同版本（live、翻唱、remix），所以互相包含就算 ——
 * 宁可借到一张近似封面，也不要整墙占位图。
 */
const isSameSong = (candidate: string, target: string): boolean => {
    const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, '');
    const left = normalize(candidate);
    const right = normalize(target);
    if (!left || !right) return false;
    return left === right || left.includes(right) || right.includes(left);
};

const artistNameOf = (song: SongResult | null | undefined): string => (
    Array.isArray(song?.artists) ? String(song?.artists?.[0]?.name ?? '') : ''
);

/**
 * 搜一次，取**匹配最高**的那条的封面。
 *
 * 搜索结果本身已按相关性排过序，所以「第一条有封面的」就是匹配最高的那个；
 * 只有当它连名字都对不上时，才退而求其次再找一条同名的。
 */
const searchBestCover = async (name: string, artist: string): Promise<string> => {
    // 动态 import：omni → providerRegistry → 各 provider → 本文件，顶层 import 会绕成环。
    const { omni } = await import('./omni');
    // 先只按歌名搜（带上歌手容易一条都搜不到），没结果再带歌手补一次。
    const queries = artist ? [name, `${name} ${artist}`] : [name];
    for (const query of queries) {
        for (const providerId of FALLBACK_PROVIDERS) {
            if (budget <= 0) return '';
            budget -= 1;
            try {
                const page = await omni.searchProviderSongs(providerId, query, { limit: 8, offset: 0 });
                const withCover = page.items.filter(item => typeof item?.album?.coverUrl === 'string' && item.album.coverUrl);
                if (withCover.length === 0) continue;
                const exact = withCover.find(item => isSameSong(String(item.name ?? ''), name));
                return String((exact ?? withCover[0]).album?.coverUrl ?? '');
            } catch {
                // 这个平台没登录 / 搜不到，换下一个，不该影响出列表。
            }
        }
    }
    return '';
};

/**
 * 异步给一首歌补封面。
 *
 * 拿到之后两件事都要做：原地写回 `song.album.coverUrl`（下一次同步读就有），
 * 以及广播「这首歌有封面了」—— 队列磁贴和几面墙要靠这一下才会重画。
 */
export const requestSongCoverFallback = (song: SongResult | null | undefined): void => {
    if (typeof window === 'undefined' || !song) return;
    const name = String(song.name ?? '').trim();
    if (!name || name === '未知标题') return;
    // 只补在线歌曲：本地歌有自己的一套（内嵌封面 / 在线匹配），别和它抢。
    if (getPlaybackSourceRef(song).kind !== 'online') return;

    const artist = artistNameOf(song);
    const key = cacheKey(name, artist);
    const cached = coverCache.get(key);
    // 缓存里已有结论：直接写回，不用再搜。
    if (cached !== undefined) {
        if (cached && song.album) song.album.coverUrl = cached;
        return;
    }
    if (pendingKeys.has(key) || budget <= 0) return;
    pendingKeys.add(key);

    const work = async () => {
        try {
            const cover = await searchBestCover(name, artist);
            coverCache.set(key, cover);
            if (!cover) return;
            if (song.album) song.album.coverUrl = cover;
            announceLocalCoverReady({ songId: String(song.id ?? ''), coverUrl: cover });
        } catch {
            coverCache.set(key, '');
        } finally {
            pendingKeys.delete(key);
        }
    };
    chain = chain.then(work, work).catch(() => undefined);
};

/**
 * 给一批曲目补封面（原地改，返回同一批）。
 *
 * 列表出口用：命中缓存的直接填上；没结论的交给异步那一路（它拿到之后会广播，
 * 界面自己重画），不在这里一首一首等 —— 等会把首屏拖住。
 */
export const backfillSongCovers = async <T extends UnifiedSong>(songs: T[], limit = PER_PAGE_LIMIT): Promise<T[]> => {
    let filled = 0;
    for (const song of songs) {
        if (filled >= limit) break;
        if (!song || song.album?.coverUrl) continue;
        const name = String(song.name ?? '').trim();
        if (!name || name === '未知标题') continue;

        const artist = artistNameOf(song);
        const key = cacheKey(name, artist);
        let cover = coverCache.get(key);
        if (cover === undefined && budget > 0) {
            // 同步等头几首：异步那一路要等界面重画才看得到，而列表 / 墙面在拿到数据后
            // 未必会再重画一次 —— 只靠广播的话，用户看到的就是「刷新了还是一片占位」。
            // 有缓存之后（第二次进同一个歌单）这里一次网络请求都不发。
            budget -= 1;
            cover = await searchBestCover(name, artist).catch(() => '');
            coverCache.set(key, cover);
            if (cover) announceLocalCoverReady({ songId: String(song.id ?? ''), coverUrl: cover });
        }
        if (!cover) {
            // 这一轮没轮到（超出限量）或预算用尽：挂到异步那一路，翻到 / 下次再补。
            requestSongCoverFallback(song);
            continue;
        }
        song.album = { ...(song.album ?? { id: '', name: '' }), coverUrl: cover };
        filled += 1;
    }
    return songs;
};
