import type { LocalSong } from '../types';
import { appDatabase } from './appDatabase';
import { applyLocalSongMatchSelection } from './localSongMatchSelectionService';
import { findAutomaticOnlineMetadataCandidate } from './onlineMetadataSearchService';

// src/services/localCoverAutoFetch.ts
// 导入之后立刻把在线封面抓下来，而不是等播到那首才抓。
//
// 为什么要有它：本地歌的封面原先只在两个时机出现 —— 导入那一刻从文件里抽出来的内嵌封面
// （安卓有、桌面端要等后台 hydration），以及「播到它」时在歌词匹配里顺手带回来的在线封面
// （useLibraryPlaybackController 的 handleLocalSongMatch）。于是刚导入完的一屏里，凡是文件
// 里没内嵌封面的歌，卡片全是占位色 —— 用户得一首首点开播一遍才有封面。
//
// 这里只补封面，不动歌名与专辑 / 歌手的归类：applyLocalSongMatchSelection 传
// metadata: 'keep'（applyMatchedMetadata 走 lyricsOnly 分支，只写 onlineMetadata，
// 不改 song.title 也不重建实体归属），cover: 'online'（写 useOnlineCover 并把封面
// 二进制缓存到 cover_local_<songId>）。封面 URL 进了 onlineMetadata，列表那边的
// getPreferredLocalSongCoverUrl 立刻就能用它，不用等播放。
//
// 三件事收着：同一首歌一次会话里只试一遍（没匹配上就别反复发搜索）、并发 2（不跟导入的
// hydration 抢 IO）、每次只碰「此刻确实没有封面」的歌（落库前再读一次，避免和后台抽内嵌
// 封面撞车——那条路补上了就不需要联网）。

/** 与 localMusicService 的 LOCAL_MUSIC_UPDATED_EVENT 同一个事件；这里不 import 那个模块，免得来回引用。 */
const LOCAL_MUSIC_UPDATED_EVENT = 'folia-local-music-updated';
const COVER_FETCH_CONCURRENCY = 2;
const REFRESH_EVERY = 8;

/** 这一会话里已经试过的歌（匹配不上也不再试）。 */
const attemptedSongIds = new Set<string>();
/** 串行链：一次导入还没跑完又来一批时排队，不并发叠加。 */
let queue: Promise<void> = Promise.resolve();

const announceLibraryUpdate = (): void => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(LOCAL_MUSIC_UPDATED_EVENT));
};

/** 这首歌此刻值不值得去联网要封面。 */
const needsOnlineCover = (song: LocalSong): boolean => (
    !song.localCoverAssetId
    && !song.onlineMetadata?.coverUrl
    && !song.noAutoMatch
    && !song.markedPureMusic
);

const fetchCoverForSong = async (song: LocalSong): Promise<boolean> => {
    // 落库前再读一次：后台 hydration 可能刚把文件里的内嵌封面抽出来写进去，
    // 那就用不着联网了（也不该让在线封面盖掉内嵌的那张）。
    const current = await appDatabase.local_music.get(song.id);
    if (!current || !needsOnlineCover(current)) return false;

    const candidate = await findAutomaticOnlineMetadataCandidate(current);
    if (!candidate?.coverUrl) return false;

    const result = await applyLocalSongMatchSelection({
        songId: current.id,
        candidate,
        metadata: 'keep',
        cover: 'online',
        lyrics: 'keep',
        matchMode: 'automatic',
    });
    return result.coverCached;
};

/**
 * 排队给这批刚导入的歌补在线封面。同步返回，不等结果 —— 导入流程不该被它拖住。
 *
 * 断网时直接不排队：这一批会在下次导入 / 刷新时被重新考虑（attemptedSongIds 不记它们）。
 */
export const fetchOnlineCoversForImportedSongs = (songs: readonly LocalSong[]): void => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const pending = songs.filter(song => needsOnlineCover(song) && !attemptedSongIds.has(song.id));
    if (pending.length === 0) return;
    pending.forEach(song => attemptedSongIds.add(song.id));

    queue = queue
        .then(async () => {
            let nextIndex = 0;
            let doneCount = 0;
            let appliedCount = 0;
            const worker = async () => {
                while (nextIndex < pending.length) {
                    const song = pending[nextIndex];
                    nextIndex += 1;
                    try {
                        if (await fetchCoverForSong(song)) appliedCount += 1;
                    } catch {
                        // 一首失败不该挡住后面的：搜索接口抖一下很常见。
                    }
                    doneCount += 1;
                    // 分批通知：一首一通知会让整面墙在导入后连着重排几十次。
                    if (appliedCount > 0 && doneCount % REFRESH_EVERY === 0) announceLibraryUpdate();
                }
            };
            await Promise.all(Array.from({ length: Math.min(COVER_FETCH_CONCURRENCY, pending.length) }, () => worker()));
            if (appliedCount > 0) announceLibraryUpdate();
            console.log(`[LocalMusic][Cover] Fetched online covers for ${appliedCount}/${pending.length} imported song(s).`);
        })
        .catch(() => undefined);
};
