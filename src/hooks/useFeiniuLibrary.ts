import { useCallback, useEffect, useRef } from 'react';
import { omni } from '../services/onlineMusic/omni';
import { clearProviderAccountSnapshot, loadProviderAccountSnapshot, saveProviderAccountSnapshot } from '../services/onlineMusic/providerAccountCache';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import { OnlineProviderError } from '../types/onlineMusic';
import type { MediaId, ProviderCollection } from '../types/onlineMusic';

// src/hooks/useFeiniuLibrary.ts
// 飞牛账户的刷新与登出（与 useBodianLibrary 同构）。
// 飞牛没有「本地后端」这个概念：地址与 token 都在渲染层的会话存储里，
// 所以「有没有配置」永远为真，未登录的表现就是 getLoginStatus 返回 null。

export const useFeiniuLibrary = () => {
    const generation = useRef(0);
    const pendingSave = useRef<Promise<unknown>>(Promise.resolve());
    const refresh = useCallback(async () => {
        const current = ++generation.current;
        const store = useOnlineProviderAccountStore.getState();
        try {
            if (!omni.getProviderAvailability('feiniu').configured || !omni.getProviderCapabilities('feiniu').auth) {
                store.clearAccount('feiniu');
                await pendingSave.current.catch(() => {});
                await clearProviderAccountSnapshot('feiniu');
                return false;
            }
            store.updateAccount('feiniu', { freshness: 'refreshing', error: undefined });
            const user = await omni.getLoginStatus('feiniu');
            if (generation.current !== current) return false;
            if (!user) {
                store.clearAccount('feiniu');
                await pendingSave.current.catch(() => {});
                await clearProviderAccountSnapshot('feiniu');
                return false;
            }
            // 换了账号才丢缓存：同一个账号沿用上次那份，界面不会先空一下。
            const visibleUser = useOnlineProviderAccountStore.getState().accounts.feiniu?.user;
            if (!visibleUser || String(visibleUser.id) !== String(user.id)) {
                store.clearAccount('feiniu');
                const snapshot = await loadProviderAccountSnapshot('feiniu').catch(() => null);
                if (generation.current !== current) return false;
                const matching = snapshot && String(snapshot.user.id) === String(user.id) ? snapshot : null;
                store.updateAccount('feiniu', { status: 'authenticated', user,
                    collections: matching?.collections || [], likedSongIds: matching?.likedSongIds || [],
                    hydration: 'ready', freshness: 'refreshing', lastUpdatedAt: matching?.savedAt, error: undefined });
            }
            const likesBeforeRefresh = useOnlineProviderAccountStore.getState().accounts.feiniu.likedSongIds;
            const collections: ProviderCollection[] = [];
            const capabilities = omni.getProviderCapabilities('feiniu');
            let offset = 0;
            if (capabilities.userLibrary) {
                while (true) {
                    const page = await omni.getProviderUserPlaylists('feiniu', user.id, { offset, limit: 50 });
                    if (generation.current !== current) return false;
                    collections.push(...page.items);
                    if (!page.hasMore || page.nextOffset <= offset) break;
                    offset = page.nextOffset;
                }
            }
            const fetchedLikedSongIds: MediaId[] = capabilities.likes ? await omni.getProviderLikedSongIds('feiniu', user.id) : [];
            if (generation.current !== current) return false;
            const save = pendingSave.current.catch(() => {}).then(() => {
                if (generation.current !== current) return null;
                // Omni replaces this array after each like mutation; keep those newer changes.
                const latestLikes = useOnlineProviderAccountStore.getState().accounts.feiniu.likedSongIds;
                const likedSongIds = latestLikes === likesBeforeRefresh ? fetchedLikedSongIds : latestLikes;
                // Commit before saving so a mutation during persistence cannot be overwritten afterward.
                store.updateAccount('feiniu', { status: 'authenticated', user, collections, likedSongIds,
                    hydration: 'ready', error: undefined });
                return saveProviderAccountSnapshot('feiniu', { user, collections, likedSongIds });
            });
            pendingSave.current = save;
            const saved = await save;
            if (generation.current !== current) return false;
            if (!saved) return false;
            store.updateAccount('feiniu', { freshness: 'fresh', lastUpdatedAt: saved.savedAt });
            return true;
        } catch (error) {
            if (generation.current !== current) return false;
            if (error instanceof OnlineProviderError && error.code === 'auth-required') {
                store.clearAccount('feiniu', 'auth-required');
                await pendingSave.current.catch(() => {});
                await clearProviderAccountSnapshot('feiniu');
            } else store.updateAccount('feiniu', { hydration: 'ready', freshness: 'error',
                status: useOnlineProviderAccountStore.getState().accounts.feiniu?.user ? 'authenticated' : 'error', error: 'feiniu-refresh-failed' });
            return false;
        }
    }, []);
    const logout = useCallback(async () => {
        generation.current++;
        useOnlineProviderAccountStore.getState().clearAccount('feiniu');
        await pendingSave.current.catch(() => {});
        await Promise.all([omni.logout('feiniu'), clearProviderAccountSnapshot('feiniu')]);
    }, []);
    useEffect(() => {
        // 启动时先按「未登录」显示，再由一次真实的 getLoginStatus 决定（token 可能已经失效）。
        useOnlineProviderAccountStore.getState().clearAccount('feiniu');
        void refresh();
        return () => { generation.current++; };
    }, [refresh]);
    return { refresh, logout };
};
