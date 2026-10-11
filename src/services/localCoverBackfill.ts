import type { LocalSong } from '../types';
import { ensureLocalSongCoverAsset } from './localMusicService';

// src/services/localCoverBackfill.ts
// 给列表上还没抽出封面的歌补一次。
//
// 为什么要补：本地歌的内嵌封面原本只在两个时机抽 —— 导入那一刻，以及播放前
// （ensureLocalSongCoverAsset 的调用点全在播放链路上）。从来没播过、也没打开过的歌单，
// 它的歌就没有 localCoverAssetId，卡片封面只能是空白；用户点开一次（走播放那条路）之后
// 才有。于是「没打开过的歌单没有封面」。
//
// 补的活按三件事收着：同一首歌一次会话里只试一遍（抽不出来就别反复抽）、串行跑（不跟
// 播放抢 IO）、只取文件头部（见 nativeAudioFile 的 preferHeadBytes）。

const attemptedSongIds = new Set<string>();
let queue: Promise<void> = Promise.resolve();

/** 抽到封面后通知界面重建 —— 与 localCoverAssetService 里那条同一个事件。 */
const announceLibraryUpdate = (): void => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('folia-local-music-updated'));
};

/**
 * 排队补齐这批歌的封面。同步返回，不等结果 —— 首屏不该被它拖住。
 *
 * `limit` 是这一次最多碰多少首，防止一次开屏对着几百首歌发请求。
 */
export const backfillLocalCovers = (songs: LocalSong[], limit: number): void => {
    const pending = songs
        .filter(song => !song.localCoverAssetId && !attemptedSongIds.has(song.id))
        .slice(0, Math.max(0, limit));
    if (pending.length === 0) return;
    pending.forEach(song => attemptedSongIds.add(song.id));

    queue = queue
        .then(async () => {
            let recovered = 0;
            for (const song of pending) {
                try {
                    const updated = await ensureLocalSongCoverAsset(song, { preferHeadBytes: true });
                    if (updated.localCoverAssetId) recovered += 1;
                } catch {
                    // 一首失败不该挡住后面的。
                }
            }
            if (recovered > 0) announceLibraryUpdate();
        })
        .catch(() => undefined);
};
