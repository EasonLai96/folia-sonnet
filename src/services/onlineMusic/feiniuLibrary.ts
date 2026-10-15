import type { MediaId, OnlineLibraryProvider, ProviderCollection } from '../../types/onlineMusic';
import { feiniuList, feiniuRequest, pickFeiniuTotal } from './feiniuTransport';
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

/**
 * 全量拉取最多翻这么多页（每页 100）。
 *
 * 服务端不给 total 时只能「取满了就继续翻」，没有上限就会一路翻到曲库末尾 ——
 * 几千首的库是几十个请求连着过桥，其它平台的请求全被挤到后面（见 feiniuTransport
 * 里那个闸门）。收藏这类列表本来也用不到全量，翻够 2000 条收手。
 */
const MAX_PAGES = 20;

/**
 * 同一批数据正在拉就直接复用，别再拉一遍。
 *
 * 「取收藏 id」和「取收藏歌曲」是两次调用、同一份数据；界面刷新时它们几乎同时发生，
 * 于是同一份列表被翻两遍 —— 无谓地翻倍了桥上的压力。
 */
const inflight = new Map<string, Promise<unknown[]>>();

const fetchAll = async <T>(path: string, query: Record<string, string | number | boolean | undefined>): Promise<T[]> => {
    const items: T[] = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await feiniuList<T>(path, query, offset, 100);
        items.push(...result.items);
        // total 为 0（服务端没给）时按「这一页取满了就还有下一页」推进。
        if (result.items.length === 0) break;
        if (result.total > 0 && offset + result.items.length >= result.total) break;
        if (result.total === 0 && result.items.length < 100) break;
        offset += result.items.length;
    }
    return items;
};

const collectAll = async <T>(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<T[]> => {
    const key = `${path}?${JSON.stringify(query)}`;
    const existing = inflight.get(key);
    if (existing) return existing as Promise<T[]>;
    const work = fetchAll<T>(path, query);
    inflight.set(key, work as Promise<unknown[]>);
    try {
        return await work;
    } finally {
        inflight.delete(key);
    }
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
    const data = await feiniuRequest<unknown>('/track/list', { query: { page: 1, size: 1 } });
    return pickFeiniuTotal(data);
};
