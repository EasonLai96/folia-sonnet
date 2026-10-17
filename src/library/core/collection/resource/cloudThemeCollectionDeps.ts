import type { SongResult } from '../../../types';
import { omni } from '../../../services/onlineMusic/omni';
import { listAiCloudCacheSongs } from '../../../services/aiCloudCache';
import type { CloudThemeCollectionDeps } from './cloudThemeCollection';

// src/library/core/services/cloudThemeCollectionDeps.ts
// 「AI 主题」资源的默认装配：歌名来自云缓存，曲目来自当前登着的那个平台。
// 单测直接给 createCloudThemeCollectionResource 注入假 deps，不经过这里。

/**
 * 拿一个歌名去平台上找那一首：只搜第一页、只取第一条 —— 云端给的是个歌名，
 * 最像它的那一条就是它。
 *
 * 用**当前**平台而不是条目上记的 platform —— 那一行记的是别人推上去那次用的平台，
 * 你未必登录了它；而播放、取音频都只能走当前这一个。
 */
export const resolveCloudThemeSong = async (songTitle: string): Promise<SongResult | null> => {
    const title = String(songTitle ?? '').trim();
    if (!title) return null;
    const page = await omni.searchSongs(title, { limit: 1, offset: 0 }).catch(() => null);
    return page?.items?.[0] ?? null;
};

export const cloudThemeDeps: CloudThemeCollectionDeps = {
    readNames: page => listAiCloudCacheSongs(page),
    resolveSong: resolveCloudThemeSong,
};
