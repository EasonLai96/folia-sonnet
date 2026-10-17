import { omni } from '../../../services/onlineMusic/omni';
import { getSongCoverUrl } from '../../../services/onlineMusic/songMetadata';
import type { OnlineHomeFeedDeps } from './onlineHomeFeeds';

// src/library/core/services/onlineHomeFeedDeps.ts
// 在线首页资源的默认装配：两个列表接口都走**按平台**的那一条（omni.getProviderUserAlbums /
// omni.getProviderHomeFeed）—— 「全部」视图要把各家的数据合在一起，只认当前平台的接口读不到别人家的。
// 封面按 provider 解析。单测直接给 createFavoriteAlbumsFeed / createRadioFeed 注入假 deps，不经过这里。

export const onlineHomeFeedDeps: OnlineHomeFeedDeps = {
    getUserAlbums: (providerId, userId, page) => omni.getProviderUserAlbums(providerId, userId, page),
    getHomeFeed: (providerId, limit) => omni.getProviderHomeFeed(providerId, limit),
    songCoverUrl: (song, providerId) => getSongCoverUrl(song, providerId),
    supportsDailySongs: providerId => omni.supportsDailySongs(providerId),
};
