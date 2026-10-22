// src/services/mediaCacheMigration.ts
/**
 * 把上一版的媒体缓存从 IndexedDB 搬进 App 私有目录。
 *
 * 旧副本躺在 IndexedDB 里，取出来只能是 `blob:` 地址，而原生播放器吃不下 `blob:` ——
 * 于是缓存里的歌恰恰是原生播不了的那批。搬进私有目录之后播放拿的是回环地址，
 * 原生与 <audio> 都能读。搬一条删一条，搬完旧的那份就不在了。
 *
 * 只在安卓上跑（拿不到回环端口就直接返回），且只跑一次：标记在**全部搬完之后**才写，
 * 中途被杀或退出，下次启动接着搬 —— 已经搬走的那些在 IndexedDB 里已经不在了，
 * 不会重复搬，也不会漏。
 */

import { getCacheKeysByPrefix, getFromCache, removeFromCache } from './db';
import { cacheLimitBytes } from './audioCache';
import { hasNativeMediaCache, writeNativeMediaCache } from './mediaCacheStore';
import { isBlob } from '../utils/blobGuards';

/** 搬完的标记。**只有**整批搬完才写，见文件头。 */
const MIGRATION_FLAG_KEY = 'folia_media_cache_migrated_v1';
/** 缓存条目的前缀（resourceKeys 里 `audio_<songKey>`）。 */
const AUDIO_CACHE_PREFIX = 'audio_';

export interface MediaCacheMigrationProgress {
    done: number;
    total: number;
}

export interface MediaCacheMigrationResult {
    migrated: number;
    total: number;
    skipped: boolean;
}

const readFlag = (): boolean => {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(MIGRATION_FLAG_KEY) === '1';
    } catch {
        return false;
    }
};

const writeFlag = (): void => {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(MIGRATION_FLAG_KEY, '1');
    } catch {
        // 存不下就算了：最坏是下次启动再搬一遍空目录。
    }
};

/** 让一帧给界面：进度条要能动，整批搬的时候不能把主线程焊死。 */
const yieldToUi = (): Promise<void> => new Promise(resolve => {
    setTimeout(resolve, 0);
});

/**
 * 搬一遍。
 *
 * 逐条处理而不是 `getCacheEntriesByPrefix` 一把全读：那个接口会把每一份字节都读进内存，
 * 缓存上百 MB 时直接把 WebView 顶爆。这里一次只有一首歌在内存里。
 */
export const migrateLegacyMediaCache = async (
    onProgress?: (progress: MediaCacheMigrationProgress) => void,
): Promise<MediaCacheMigrationResult> => {
    if (!(await hasNativeMediaCache())) return { migrated: 0, total: 0, skipped: true };
    if (readFlag()) return { migrated: 0, total: 0, skipped: true };

    const keys = await getCacheKeysByPrefix([AUDIO_CACHE_PREFIX]);
    if (keys.length === 0) {
        writeFlag();
        return { migrated: 0, total: 0, skipped: false };
    }

    const limit = cacheLimitBytes();
    let migrated = 0;
    let done = 0;
    for (const key of keys) {
        const value = await getFromCache<unknown>(key);
        // 同一前缀下还有别的东西（`audioLevel_<songKey>` 存的是音质等级，不是字节）：
        // 不是字节的一律不动，它们不是这一趟要搬的，删了会丢信息。
        if (isBlob(value) && await writeNativeMediaCache(key, value, limit)) {
            await removeFromCache(key);
            migrated += 1;
        }
        done += 1;
        onProgress?.({ done, total: keys.length });
        await yieldToUi();
    }

    writeFlag();
    return { migrated, total: keys.length, skipped: false };
};
