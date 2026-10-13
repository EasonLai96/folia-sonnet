import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { HomeViewTab } from '../../../types';
import type { ProviderCollection, ProviderUser } from '../../../types/onlineMusic';
import type { LibraryHomeOnlineSource, LibraryHomeTabView } from '../contracts/homeModel';
import type { LibraryAccountController } from '../contracts/account';
import { isOnlineHomeTab, resolveHomeOnlineSource, resolveHomeTabs, translateHomeTabs } from '../model/homeSources';
import { resolveActiveProviderSummary } from '../model/accountRules';
import { readOnlineProviderCapabilities, readOnlineProviderLabel } from '../services/onlineHomeProvider';
import { useSearchNavigationStore } from '../../../stores/useSearchNavigationStore';
import { useHomeLayoutSettingsStore } from '../../../stores/useHomeLayoutSettingsStore';
import { usePersonalFmModeStore } from '../../../stores/usePersonalFmModeStore';
import { getLocalLibraryAvailability } from '../../../services/localLibraryAvailability';
import { getPersonalFmSelectionLabel } from '../../../services/onlineMusic/fmModes';
import { useLibraryAccountProviders } from './useLibraryAccount';
import { mergeProviderCollections } from '../model/onlineProviderScope';
import { selectIsAllProvidersScope, useLibraryOnlineProviderScopeStore } from '../state/useLibraryOnlineProviderScopeStore';

// src/library/core/bindings/useLibraryHomeSources.ts
// 首页的来源与一级页签：当前页签（搜索导航 store 持有）、当前在线来源（provider、账户、能力）、
// 页签列表与不可用原因（规则在 core/model/homeSources，这里翻译）、私人 FM 卡上显示的当前模式。
// 只订阅这几样（页签、页签显示开关、FM 模式），别的 store 写入不会让首页重渲染。

export type LibraryHomeSources = {
    tab: HomeViewTab;
    setTab: (tab: HomeViewTab) => void;
    isOnlineTab: boolean;
    online: LibraryHomeOnlineSource;
    tabs: LibraryHomeTabView[];
    /** FM 卡上的当前模式（provider 不支持模式时为空）。 */
    personalFmModeLabel: string;
};

export const useLibraryHomeSources = ({
    account,
    user,
    playlists,
    cloudPlaylist = null,
    navidromeEnabled = false,
}: {
    /** 在线账户 controller：当前平台与它的账户摘要来自快照（未变时身份稳定）。 */
    account: LibraryAccountController;
    /** 应用传入的旧账户与歌单（只有网易云在平台还没给出摘要时用）。 */
    user: ProviderUser | null;
    playlists: ProviderCollection[];
    cloudPlaylist?: ProviderCollection | null;
    navidromeEnabled?: boolean;
}): LibraryHomeSources => {
    const { t } = useTranslation();
    const { tab, setTab } = useSearchNavigationStore(useShallow(state => ({
        tab: state.homeViewTab,
        setTab: state.setHomeViewTab,
    })));
    const visibility = useHomeLayoutSettingsStore(useShallow(state => ({
        playlist: state.showHomeTabPlaylist,
        radio: state.showHomeTabRadio,
        albums: state.showHomeTabAlbums,
        local: state.showHomeTabLocal,
    })));
    // The FM card doubles as the mode readout: the card is the only place the current mode shows
    // up outside the player, and the picker can change it while this grid stays mounted.
    const personalFmSelection = usePersonalFmModeStore(state => state.selection);

    const { providers, activeProviderId: providerId } = useLibraryAccountProviders(account);
    // 「全部」：只看首页在线这一屏的数据范围（见 core/state/useLibraryOnlineProviderScopeStore）。
    const allProviders = useLibraryOnlineProviderScopeStore(selectIsAllProvidersScope);
    const provider = useMemo(() => resolveActiveProviderSummary(providers, providerId), [providerId, providers]);
    const capabilities = readOnlineProviderCapabilities(providerId);
    const { userLibrary, playlists: canListPlaylists, userAlbums, recommendations, personalFmModes } = capabilities;
    const online = useMemo(() => {
        const base = resolveHomeOnlineSource({
            providerId,
            provider,
            capabilities: { ...capabilities, userLibrary, playlists: canListPlaylists, userAlbums, recommendations, personalFmModes },
            fallbackLabel: readOnlineProviderLabel(providerId),
            fallbackUser: user,
            fallbackPlaylists: playlists,
            fallbackCloud: cloudPlaylist,
            platformAvailable: true,
        });
        if (!allProviders) return base;
        /*
         * 「全部」：当前平台不变（登录、搜索、播放仍按它走），只有首页这一屏的数据换成各家歌单的合并结果。
         *
         * 两处要跟着改，否则合并视图是空的：
         * - `collections` 换成合并结果（原本只给当前平台自己的）；
         * - `canUsePlaylists` 按合并结果判：它原本是**当前平台**的能力，当前平台恰好不支持歌单时，
         *   歌单页签会显示「该平台不支持」并把合并结果藏掉 —— 而合起来明明有东西。
         * - `accountView` 同理：当前平台没登录时它是 guest，墙会整个空着、只剩登录入口，
         *   而别的平台是登录着的。合并出东西了就按「有内容」显示（登录入口仍在缝里的账户位上）。
         */
        const merged = mergeProviderCollections(providers);
        return {
            ...base,
            collections: merged,
            canUsePlaylists: merged.length > 0,
            ...(merged.length > 0 ? { accountView: 'authenticated' as const, providerLabel: t('home.allProviders') } : {}),
        };
    }, [
        // capabilities 每次读都是新对象：按用到的几个开关比较。
        // eslint-disable-next-line react-hooks/exhaustive-deps
        allProviders, canListPlaylists, cloudPlaylist, personalFmModes, playlists, provider, providers, providerId,
        recommendations, t, user, userAlbums, userLibrary,
    ]);

    const localAvailability = getLocalLibraryAvailability();
    const tabs = useMemo(() => translateHomeTabs(resolveHomeTabs({
        visibility,
        navidromeEnabled,
        online,
        localAvailability: { supported: localAvailability.supported, reason: localAvailability.reason },
    }), t), [localAvailability.reason, localAvailability.supported, navidromeEnabled, online, t, visibility]);

    const personalFmModeLabel = online.hasPersonalFmModes
        ? getPersonalFmSelectionLabel(personalFmSelection, (key, fallback) => t(key, fallback ?? ''))
        : '';

    return {
        tab,
        setTab,
        isOnlineTab: isOnlineHomeTab(tab),
        online,
        tabs,
        personalFmModeLabel,
    };
};
