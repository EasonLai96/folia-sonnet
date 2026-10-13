/**
 * 「这首歌现在有封面了」的广播。
 *
 * 为什么要单独一个模块：广播方有两个 —— `localMusicService` 从文件里抽出内嵌封面，
 * `localSongMatchSelectionService` 写入在线封面 —— 而它们互相不能 import。
 * 依赖是 `localCoverAutoFetch → localSongMatchSelectionService`，而 `localMusicService`
 * 又 import 了 `localCoverAutoFetch`：直接互相引用就是一条环（playbackAdapters 那边
 * 已经因为同样的理由把 backfill 改成动态 import 了）。常量放在这里，两边都能拿。
 */
export const LOCAL_COVER_READY_EVENT = 'folia-local-cover-ready';

export type LocalCoverReadyDetail = {
    songId: string;
    /** 内嵌封面：只给资源 id，收的一方自己换成 URL（不同尺寸的 URL 不一样）。 */
    assetId?: string;
    /** 在线封面：可直接用的 URL。 */
    coverUrl?: string;
};

/**
 * 广播一次封面就绪。
 *
 * 为什么必须有它：队列（磁贴墙铺的就是它）里的 `album.coverUrl` 是**建队那一刻**
 * 烤进去的快照，之后歌曲记录上的封面字段再怎么变它都看不见。没有这个事件，
 * 「后来才有的封面」永远进不了磁贴墙 —— 播放页有封面、磁贴墙一片空白。
 */
export const announceLocalCoverReady = (detail: LocalCoverReadyDetail): void => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(LOCAL_COVER_READY_EVENT, { detail }));
};
