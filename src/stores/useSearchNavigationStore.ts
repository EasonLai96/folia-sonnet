import { create } from 'zustand';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import type { HomeViewTab, LocalSong, SongResult, UnifiedSong } from '../types';
import { DEFAULT_ONLINE_PROVIDER_ID, OnlineProviderError, type OnlineProviderId } from '../types/onlineMusic';
import { noteProviderAuthExpired } from '../services/onlineMusic/authExpiry';
import {
    applyLocalLibraryEntityDisplay,
    buildUnifiedLocalSong,
    type LocalLibraryDisplayCatalog,
} from '../services/playbackAdapters';
import { omni } from '../services/onlineMusic/omni';
import { isLocalPlaybackSong, isNavidromePlaybackSong } from '../utils/appPlaybackGuards';
import { supportsLocalMusicImport } from '../platform/runtime';
import { listAiCloudCacheSongs } from '../services/aiCloudCache';
import { resolveCloudThemeSong } from '../library/core/collection/resource/cloudThemeCollectionDeps.service';

const LAST_HOME_VIEW_TAB_KEY = 'last_home_view_tab';
const DEFAULT_SEARCH_LIMIT = 30;
/** 'cloud' = 「AI 主题」：在云端缓存的歌名里搜（曲目由客户端拿名字去平台上搜出来）。 */
/** 'all' = 「全部」：每个能搜的在线平台各匀一点，掺上本地曲库一起出。 */
export type SearchSource = OnlineProviderId | 'local' | 'navidrome' | 'cloud' | 'all';
export type SearchReturnView = 'home' | 'player';

type SearchExecutorDeps = {
    localSongs: LocalSong[];
    localLibraryCatalog?: LocalLibraryDisplayCatalog;
    t: (key: string, fallback?: string) => string;
};

type SearchExecutionResult = {
    results: UnifiedSong[];
    hasMore: boolean;
    nextOffset: number;
};

type SearchCacheEntry = {
    results: UnifiedSong[];
    offset: number;
    hasMore: boolean;
    scrollTop: number;
};

interface SearchNavigationState {
    homeViewTab: HomeViewTab;
    searchQuery: string;
    searchSourceTab: SearchSource;
    searchResults: UnifiedSong[] | null;
    searchReturnView: SearchReturnView;
    isSearchOpen: boolean;
    isSearching: boolean;
    isLoadingMore: boolean;
    searchError: string | null;
    /**
     * 搜索撞到“登录态失效”的那个平台。
     *
     * `searchError` 存的是 provider 抛出来的英文原话（"FeiNiu is not signed in"），
     * 直接摆到界面上没人看得懂；而这里要的是**能点名平台**的中文提示，
     * 那是展示层（能拿到 i18n 和平台显示名）的事，store 只负责把事实记下来。
     */
    searchAuthExpiredProvider: OnlineProviderId | null;
    requestId: number;
    offset: number;
    limit: number;
    hasMore: boolean;
    scrollTop: number;
    searchCache: Record<string, SearchCacheEntry>;
    setHomeViewTab: (tab: HomeViewTab) => void;
    setSearchQuery: (query: string) => void;
    setSearchScrollTop: (scrollTop: number) => void;
    restoreSearch: (payload: { query: string; sourceTab: SearchSource; returnView?: SearchReturnView; }) => void;
    hideSearchOverlay: () => void;
    resetRuntime: (onlineProviderId?: OnlineProviderId) => void;
    followOnlineProvider: (providerId: OnlineProviderId) => void;
    submitSearch: (payload: { query?: string; sourceTab: SearchSource; deps: SearchExecutorDeps; returnView?: SearchReturnView; }) => Promise<boolean>;
    loadMoreSearchResults: (payload: { deps: SearchExecutorDeps; }) => Promise<void>;
}

const getSearchCacheKey = (query: string, sourceTab: SearchSource) => (
    `${sourceTab}:${query.trim().toLowerCase()}`
);

export const resolveSearchSource = (tab: HomeViewTab | SearchSource): SearchSource => {
    if (tab === 'local' || tab === 'navidrome' || tab === 'cloud' || tab === 'all') {
        return tab;
    }
    if (tab !== 'playlist' && tab !== 'albums' && tab !== 'radio' && tab !== 'explore') return tab as OnlineProviderId;
    return DEFAULT_ONLINE_PROVIDER_ID;
};

/** 这条搜索来源对应的在线平台；本地 / Navidrome / 云缓存 / 「全部」没有单一平台，返回 null。 */
const providerIdOf = (tab: SearchSource): OnlineProviderId | null => {
    const resolved = resolveSearchSource(tab);
    return resolved === 'local'
        || resolved === 'navidrome'
        || resolved === 'cloud'
        || resolved === 'all'
        ? null
        : resolved;
};

export const resolveCommandPaletteSearchSource = (
    currentSong: SongResult | null,
    searchSourceTab: SearchSource,
    activeOnlineProviderId: OnlineProviderId,
): SearchSource => {
    if (currentSong && isLocalPlaybackSong(currentSong)) return 'local';
    if (currentSong && isNavidromePlaybackSong(currentSong)) return 'navidrome';
    if (currentSong || searchSourceTab === DEFAULT_ONLINE_PROVIDER_ID) return activeOnlineProviderId;
    return searchSourceTab;
};

const mapLocalSongToUnifiedSong = (
    song: LocalSong,
    catalog?: LocalLibraryDisplayCatalog,
): UnifiedSong => applyLocalLibraryEntityDisplay(buildUnifiedLocalSong({
        localSong: song,
        matchedSong: null,
        coverUrl: song.useOnlineCover ? song.onlineMetadata?.coverUrl || null : null,
        preferOnlineMetadata: false,
    }), catalog);

const searchLocalSongs = (
    deps: SearchExecutorDeps,
    query: string,
): SearchExecutionResult => {
    const lowerQuery = query.toLowerCase();
    const results = deps.localSongs
        .filter(song => {
            const title = song.title.toLowerCase();
            const artist = [
                ...song.importedMetadata.artistNames,
                ...song.onlineMetadata?.artists.map(item => item.name) || [],
            ].join(' ').toLowerCase();
            const album = [song.importedMetadata.albumName, song.onlineMetadata?.album?.name]
                .filter(Boolean).join(' ').toLowerCase();
            return title.includes(lowerQuery) || artist.includes(lowerQuery) || album.includes(lowerQuery);
        })
        .map(song => mapLocalSongToUnifiedSong(song, deps.localLibraryCatalog));

    return {
        results,
        hasMore: false,
        nextOffset: results.length,
    };
};

const searchNavidromeSongs = async (query: string): Promise<SearchExecutionResult> => {
    const config = getNavidromeConfig();
    if (!config) {
        return { results: [], hasMore: false, nextOffset: 0 };
    }

    const response = await navidromeApi.search(config, query, 0, 0, DEFAULT_SEARCH_LIMIT);
    const results = (response.song || []).map(song => {
        const navidromeSong = navidromeApi.toNavidromeSong(config, song);
        return navidromeSong as UnifiedSong;
    });

    return {
        results,
        hasMore: false,
        nextOffset: results.length,
    };
};

/**
 * 一批并发跑，跑完再换下一批。
 *
 * 「AI 主题」那一屏每一首都要拿歌名去平台上搜一次 —— 一次 30 个并发会把 Capacitor
 * 那座桥占死（别的平台跟着一起超时，见 Capacitor 桥那节），所以压到 6 个。
 */
const CLOUD_RESOLVE_CONCURRENCY = 6;

const mapWithConcurrency = async <T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T) => Promise<R>,
): Promise<R[]> => {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) return;
            results[index] = await worker(items[index] as T);
        }
    });
    await Promise.all(lanes);
    return results;
};

/**
 * 「AI 主题」：在云端缓存的歌名里**搜**，或者不带词地**逛**。
 *
 * 云端只存歌名，所以先按名字在云端要一批（给了词就是筛），再拿这些名字去当前登着的
 * 平台把曲目搜出来 —— 与首页那一屏同一条路（cloudThemeCollectionDeps）。
 * 平台上搜不到的名字直接不出结果：列一行播不了的歌没有意义。
 *
 * **不带词 = 逛**：服务端按 `updated_at DESC` 排，永远从最新那一条开始翻，于是每次
 * 进来都是同一批歌。这里先问一次总数，再随机挑一个起点，从那儿顺序往下翻 —— 每次
 * 看到的是库里不同的一个窗口。剩下的交给 `loadMoreSearchResults` 接着往下懒加载。
 *
 * 随机起点只在第一页算：翻页时沿用传进来的 offset，否则每翻一页都跳到别处去。
 */
const searchCloudThemeSongs = async (
    query: string,
    limit: number,
    offset: number,
): Promise<SearchExecutionResult> => {
    const browsing = !query.trim();
    let start = offset;
    if (browsing && offset === 0) {
        const probe = await listAiCloudCacheSongs({ limit: 1, offset: 0 }).catch(() => null);
        const total = Number(probe?.total ?? 0);
        if (total > limit) {
            start = Math.floor(Math.random() * (total - limit + 1));
        }
    }
    const page = await listAiCloudCacheSongs({ limit, offset: start, query }).catch(() => null);
    const names = page?.songs ?? [];
    if (names.length === 0) return { results: [], hasMore: false, nextOffset: offset };
    const found = await mapWithConcurrency(
        names,
        CLOUD_RESOLVE_CONCURRENCY,
        entry => resolveCloudThemeSong(entry.songTitle).catch(() => null),
    );
    const results = found.filter((song): song is UnifiedSong => Boolean(song));
    const total = Number(page?.total ?? 0);
    const consumed = start + names.length;
    return { results, hasMore: consumed < total, nextOffset: consumed };
};

const searchOnlineProviderSongs = async (
    providerId: OnlineProviderId,
    query: string,
    limit: number,
    offset: number,
): Promise<SearchExecutionResult> => {
    const page = await omni.searchProviderSongs(providerId, query, { limit, offset });
    return { results: page.items, hasMore: page.hasMore, nextOffset: page.nextOffset };
};

/** 「全部」里同时跑几个平台：再高就要占住 Capacitor 那座桥（见 mapWithConcurrency 那条注释）。 */
const ALL_SEARCH_CONCURRENCY = 4;

/** 同一首歌在几家平台上重复出现时用的比对键。 */
const mergeSongKey = (song: UnifiedSong): string => (
    `${(song.name ?? '').trim().toLowerCase()}|${(song.artists ?? [])
        .map(artist => artist?.name ?? '')
        .join(' ')
        .trim()
        .toLowerCase()}`
);

/**
 * 「全部」：所有能搜的在线平台一起搜，再掺上本地曲库和 Navidrome。
 *
 * 掺的那两份只在第一页加：本地那条路是同步过滤、Navidrome 也不认 offset，翻页时再要一次会
 * 原样重复一遍。单个平台失败（没登录、超时）只丢那一家，不让这一整屏空掉 —— 「全部」本来就是
 * 「有几家出几家」。
 */
const searchAllSources = async (
    query: string,
    offset: number,
    limit: number,
    deps: SearchExecutorDeps,
): Promise<SearchExecutionResult> => {
    const providerIds = omni.getProviderSummaries()
        .filter(summary => omni.getProviderCapabilities(summary.providerId).search)
        .map(summary => summary.providerId);
    // 每家匀一点：四家各要一整页就是 120 条，第一屏根本翻不到那么远。
    const perProvider = Math.max(8, Math.ceil(limit / Math.max(1, providerIds.length)));
    const pages = await mapWithConcurrency(providerIds, ALL_SEARCH_CONCURRENCY, async providerId => {
        try {
            return await searchOnlineProviderSongs(providerId, query, perProvider, offset);
        } catch (error) {
            console.warn('[SearchStore] "all" search skipped a provider:', providerId, error);
            return null;
        }
    });

    const buckets: UnifiedSong[][] = [];
    let hasMore = false;
    pages.forEach(page => {
        if (!page) return;
        if (page.results.length > 0) buckets.push(page.results);
        if (page.hasMore) hasMore = true;
    });

    if (offset === 0) {
        const local = searchLocalSongs(deps, query).results;
        if (local.length > 0) buckets.push(local);
        const navidrome = (await searchNavidromeSongs(query)).results;
        if (navidrome.length > 0) buckets.push(navidrome);
    }

    // 轮着从每个桶里拿一条：第一屏就能看见各家都有，而不是先看完一整页网易云。
    const merged: UnifiedSong[] = [];
    const seen = new Set<string>();
    const deepest = buckets.reduce((widest, bucket) => Math.max(widest, bucket.length), 0);
    for (let index = 0; index < deepest; index += 1) {
        buckets.forEach(bucket => {
            const song = bucket[index];
            if (!song) return;
            // 同一首几个平台都有：只留先到的那一份，否则一屏里同一首排四五遍。
            const key = mergeSongKey(song);
            if (seen.has(key)) return;
            seen.add(key);
            merged.push(song);
        });
    }

    return { results: merged, hasMore, nextOffset: offset + perProvider };
};

const executeSearch = async (
    query: string,
    sourceTab: SearchSource,
    offset: number,
    limit: number,
    deps: SearchExecutorDeps
): Promise<SearchExecutionResult> => {
    if (sourceTab === 'local') {
        return searchLocalSongs(deps, query);
    }

    if (sourceTab === 'navidrome') {
        return searchNavidromeSongs(query);
    }

    if (sourceTab === 'cloud') {
        return searchCloudThemeSongs(query, limit, offset);
    }

    if (sourceTab === 'all') {
        return searchAllSources(query, offset, limit, deps);
    }

    return searchOnlineProviderSongs(sourceTab, query, limit, offset);
};

const getInitialHomeViewTab = (): HomeViewTab => {
    if (typeof window === 'undefined') {
        return 'playlist';
    }
    const savedTab = localStorage.getItem(LAST_HOME_VIEW_TAB_KEY);
    return savedTab === 'playlist'
        || (savedTab === 'local' && supportsLocalMusicImport())
        || savedTab === 'albums'
        || savedTab === 'navidrome'
        || savedTab === 'radio'
        || savedTab === 'explore'
        ? savedTab
        : 'playlist';
};

export const useSearchNavigationStore = create<SearchNavigationState>((set, get) => ({
    homeViewTab: getInitialHomeViewTab(),
    searchQuery: '',
    searchSourceTab: DEFAULT_ONLINE_PROVIDER_ID,
    searchResults: null,
    searchReturnView: 'home',
    isSearchOpen: false,
    isSearching: false,
    isLoadingMore: false,
    searchError: null,
    searchAuthExpiredProvider: null,
    requestId: 0,
    offset: 0,
    limit: DEFAULT_SEARCH_LIMIT,
    hasMore: false,
    scrollTop: 0,
    searchCache: {},
    setHomeViewTab: (tab) => {
        const resolvedTab = tab === 'local' && !supportsLocalMusicImport() ? 'playlist' : tab;
        if (typeof window !== 'undefined') {
            localStorage.setItem(LAST_HOME_VIEW_TAB_KEY, resolvedTab);
        }
        set({ homeViewTab: resolvedTab });
    },
    setSearchQuery: (query) => set({ searchQuery: query }),
    setSearchScrollTop: (scrollTop) => set(state => {
        const cacheKey = getSearchCacheKey(state.searchQuery, state.searchSourceTab);
        const cached = state.searchCache[cacheKey];
        return {
            scrollTop,
            searchCache: cached
                ? {
                    ...state.searchCache,
                    [cacheKey]: { ...cached, scrollTop },
                }
                : state.searchCache,
        };
    }),
    restoreSearch: ({ query, sourceTab, returnView = 'home' }) => set(state => {
        const cached = state.searchCache[getSearchCacheKey(query, sourceTab)];
        return {
            searchQuery: query,
            searchSourceTab: sourceTab,
            searchReturnView: returnView,
            searchResults: cached?.results ?? null,
            offset: cached?.offset ?? 0,
            hasMore: cached?.hasMore ?? false,
            scrollTop: cached?.scrollTop ?? 0,
            searchError: null,
            searchAuthExpiredProvider: null,
            isSearching: false,
            isLoadingMore: false,
            isSearchOpen: true,
        };
    }),
    hideSearchOverlay: () => set({ isSearchOpen: false, searchReturnView: 'home' }),
    resetRuntime: (onlineProviderId) => set(state => ({
        searchQuery: '',
        searchSourceTab: onlineProviderId ?? state.searchSourceTab,
        searchResults: null,
        searchReturnView: 'home',
        isSearchOpen: false,
        isSearching: false,
        isLoadingMore: false,
        searchError: null,
        searchAuthExpiredProvider: null,
        requestId: state.requestId + 1,
        offset: 0,
        hasMore: false,
        scrollTop: 0,
    })),
    // The overlay's online source is the active provider. A switch moves it through resetRuntime, but
    // the active provider also changes without one (startup, session restore, a Folium mod source going
    // away), so this keeps it in step. Local and Navidrome are left alone, and the results stay: clearing
    // them is the switch's job.
    followOnlineProvider: (providerId) => set(state => (
        // 「本地」「Navidrome」「AI 主题」「全部」都不是某个在线平台：换了当前平台也不该把用户
        // 从这几个页签上挪走（原来只放了前两个，于是停在「AI 主题」时换平台会被踢回网易云）。
        state.searchSourceTab === 'local'
            || state.searchSourceTab === 'navidrome'
            || state.searchSourceTab === 'cloud'
            || state.searchSourceTab === 'all'
            || state.searchSourceTab === providerId
            ? state
            : { searchSourceTab: providerId }
    )),
    submitSearch: async ({ query, sourceTab, deps, returnView = 'home' }) => {
        const trimmedQuery = (query ?? get().searchQuery).trim();
        /*
         * 「AI 主题」那一屏是**逛**云端缓存里都有什么歌：点那个页签时手上还没有词，
         * 空词也要能拉一屏下来（随机起点那一段见 searchCloudThemeSongs）。
         */
        if (!trimmedQuery && sourceTab !== 'cloud') {
            return false;
        }

        const requestId = get().requestId + 1;
        set({
            searchQuery: trimmedQuery,
            searchSourceTab: sourceTab,
            searchReturnView: returnView,
            isSearchOpen: true,
            isSearching: true,
            isLoadingMore: false,
            searchError: null,
            searchAuthExpiredProvider: null,
            requestId,
            searchResults: null,
            offset: 0,
            hasMore: false,
            scrollTop: 0,
        });

        try {
            const result = await executeSearch(trimmedQuery, sourceTab, 0, get().limit, deps);
            if (get().requestId !== requestId) {
                return true;
            }
            set(state => ({
                searchResults: result.results,
                hasMore: result.hasMore,
                offset: result.nextOffset,
                isSearching: false,
                searchCache: {
                    ...state.searchCache,
                    [getSearchCacheKey(trimmedQuery, sourceTab)]: {
                        results: result.results,
                        hasMore: result.hasMore,
                        offset: result.nextOffset,
                        scrollTop: 0,
                    },
                },
            }));
            return true;
        } catch (error) {
            console.error('[SearchStore] submitSearch failed:', error);
            if (get().requestId !== requestId) {
                return true;
            }
            /*
             * 登录态失效是最该被看见的一类失败：它就发生在搜索这一下，
             * 界面上却是干干净净的「没有结果」—— 用户只会以为这首歌搜不到。
             * 记下平台，顺手把账号标成过期（首页和账户面板那套「登录已过期」会亮起来），
             * 展示层再据此把提示换成能点名平台的那一句。
             */
            const authProviderId = error instanceof OnlineProviderError
                && error.code === 'auth-required'
                ? (error.providerId ?? providerIdOf(sourceTab))
                : null;
            if (authProviderId) {
                noteProviderAuthExpired(authProviderId);
            }
            set({
                searchResults: [],
                hasMore: false,
                offset: 0,
                isSearching: false,
                searchError: error instanceof Error ? error.message : 'search_failed',
                searchAuthExpiredProvider: authProviderId,
            });
            return true;
        }
    },
    loadMoreSearchResults: async ({ deps }) => {
        const {
            searchQuery,
            searchSourceTab,
            searchResults,
            hasMore,
            isSearching,
            isLoadingMore,
            offset,
            limit,
        } = get();

        if (
            searchSourceTab === 'local'
            || searchSourceTab === 'navidrome'
            || !hasMore
            || isSearching
            || isLoadingMore
            // 「AI 主题」是逛：它本来就没有词，空词也要能接着往下翻（见 submitSearch 那条注释）。
            || (!searchQuery.trim() && searchSourceTab !== 'cloud')
        ) {
            return;
        }

        const requestId = get().requestId;
        set({ isLoadingMore: true, searchError: null });

        try {
            const result = await executeSearch(searchQuery, searchSourceTab, offset, limit, deps);
            if (get().requestId !== requestId) {
                return;
            }
            set(state => {
                const results = [...(searchResults || []), ...result.results];
                return {
                    searchResults: results,
                    hasMore: result.hasMore,
                    offset: result.nextOffset,
                    isLoadingMore: false,
                    searchCache: {
                        ...state.searchCache,
                        [getSearchCacheKey(searchQuery, searchSourceTab)]: {
                            results,
                            hasMore: result.hasMore,
                            offset: result.nextOffset,
                            scrollTop: state.scrollTop,
                        },
                    },
                };
            });
        } catch (error) {
            console.error('[SearchStore] loadMoreSearchResults failed:', error);
            if (get().requestId === requestId) {
                set({
                    isLoadingMore: false,
                    searchError: error instanceof Error ? error.message : 'search_failed',
                });
            }
        }
    },
}));
