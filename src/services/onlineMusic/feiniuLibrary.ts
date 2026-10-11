import type { MediaId, OnlineLibraryProvider, ProviderCollection } from '../../types/onlineMusic';
import { feiniuList, feiniuRequest } from './feiniuTransport';
import { FEINIU_FAVORITE_ID } from './feiniuCatalog';
import { feiniuPage, normalizeFeiniuCollection, normalizeFeiniuSong } from './feiniuNormalize';

// src/services/onlineMusic/feiniuLibrary.ts
// 用户自己的歌单 / 专辑 / 收藏。飞牛的接口不按 userId 过滤（服务端就认当前登录态），
// userId 参数在这里没有用处。

/** 「我喜欢的」是一个固定 id 的伪歌单，指向飞牛自己的收藏接口。 */
const favoriteCollection = (): ProviderCollection => ({
    providerId: 'feiniu',
    id: FEINIU_FAVORITE_ID,
    type: 'playlist',
    name: '我喜欢的音乐',
    trackCount: 0,
    isOwned: true,
    isLiked: true,
});

const collectAll = async <T>(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<T[]> => {
    const items: T[] = [];
    let offset = 0;
    while (true) {
        const page = await feiniuList<T>(path, query, offset, 100);
        items.push(...page.items);
        // total 为 0（服务端没给）时按「这一页取满了就还有下一页」推进。
        if (page.items.length === 0) break;
        if (page.total > 0 && offset + page.items.length >= page.total) break;
        if (page.total === 0 && page.items.length < 100) break;
        offset += page.items.length;
        if (offset > 20_000) break;
    }
    return items;
};

export const feiniuLibrary: OnlineLibraryProvider = {
    async getUserPlaylists(_userId, limit, offset) {
        const { items, total } = await feiniuList<unknown>('/playlist/list', {}, offset, limit);
        const playlists = items.map(item => normalizeFeiniuCollection(item, 'playlist'));
        // 收藏放在最前面：界面上它和歌单并列，但没有真歌单 id。
        const all = offset === 0 ? [favoriteCollection(), ...playlists] : playlists;
        return feiniuPage(all, total + 1, offset, limit);
    },

    async getUserAlbums(_userId, limit, offset) {
        const { items, total } = await feiniuList<unknown>('/album/list', {}, offset, limit);
        return feiniuPage(items.map(item => normalizeFeiniuCollection(item, 'album')), total, offset, limit);
    },

    async getLikedSongIds() {
        const items = await collectAll<{ guid?: unknown }>('/favorite-track/list');
        return items
            .map(item => String(item?.guid ?? ''))
            .filter((guid): guid is string => Boolean(guid)) as MediaId[];
    },

    async getLikedSongs() {
        const items = await collectAll<unknown>('/favorite-track/list');
        return items.map(normalizeFeiniuSong);
    },
};

/** 播放历史（首页「最近播放」用）。 */
export const feiniuPlayHistory = async (limit = 100) => {
    const { items } = await feiniuList<unknown>('/play-history/list', {}, 0, limit);
    return items.map(normalizeFeiniuSong);
};

/** 曲目总数，给「我的音乐」这类概览用。 */
export const feiniuTrackCount = async (): Promise<number> => {
    const data = await feiniuRequest<{ total?: number }>('/track/list', { query: { page: 1, size: 1 } });
    return Number(data?.total) || 0;
};
