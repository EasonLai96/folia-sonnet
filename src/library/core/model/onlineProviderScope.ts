import type { OnlineProviderId, ProviderAccountSummary, ProviderCollection } from '../../../types/onlineMusic';

// src/library/core/model/onlineProviderScope.ts
// 首页在线页签「看谁的数据」的两种范围：跟着当前平台（默认），或「全部」—— 把各家已登录平台的歌单合在一起看。
// 「全部」不是一家平台：它是列表顶部的一行，选了之后当前平台不变（登录、搜索、播放仍按当前平台走），
// 只有首页歌单那一屏的数据换成合并结果，所以每张封面要标出它来自哪家（sourceProviderId → 封面右下角的图标）。

/**
 * 「全部」这个虚拟来源的 id。真实 providerId 是各家自己的标识（netease / qq / kugou / bodian / feiniu，
 * 以及 Folium mod 源自己的 id），这里取一个它们都不会用到的值（带下划线），免得撞车。
 */
export const ALL_PROVIDERS_ID = '__all__';

export const isAllProvidersId = (providerId: string | null | undefined): boolean => providerId === ALL_PROVIDERS_ID;

/**
 * 这家平台此刻有没有能合进「全部」的歌单：已配置、且已登录（或压根不需要账户 —— Folium mod 源），
 * 并且真读到了歌单。「未登录」「读失败」「还在读」的平台不进，合进去只会多一片空墙。
 */
const hasUsableCollections = (provider: ProviderAccountSummary): boolean => (
    provider.availability.configured
    && (provider.status === 'authenticated' || provider.requiresAccount === false)
    && provider.collections.length > 0
);

/**
 * 各家的歌单按平台顺序拼在一起（同一家内部的顺序照旧，也就是各 provider 给的顺序）。
 * 每条都盖上自己那家的 providerId：provider 摘要里理论上已经带了，但「哪家来的」是合并视图唯一的
 * 身份信息（封面角标与打开歌单都靠它），宁可在这里补一次也别让下游猜。
 */
export const mergeProviderCollections = (
    providers: readonly ProviderAccountSummary[],
): ProviderCollection[] => providers
    .filter(hasUsableCollections)
    .flatMap(provider => provider.collections.map(collection => (
        collection.providerId ? collection : { ...collection, providerId: provider.providerId }
    )));

/** 合并视图里有多少家平台真的贡献了歌单（「全部」那一行上可以显示它）。 */
export const countMergeableProviders = (providers: readonly ProviderAccountSummary[]): number => (
    providers.filter(hasUsableCollections).length
);

/** 卡片 id 在合并视图里的唯一化前缀：不同平台的歌单 id 会撞（都是数字），按平台分开。 */
export const scopeCardId = (providerId: OnlineProviderId | string | null | undefined, id: string | number): string => (
    providerId ? `${providerId}:${id}` : String(id)
);
