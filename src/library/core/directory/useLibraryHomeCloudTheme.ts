import { useEffect, useRef } from 'react';
import type { HomeViewTab } from '../../../types';
import { AI_THEME_COLLECTION_ID, type CloudGridViewCollectionDescriptor } from '../contracts/collection';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';

// src/library/core/bindings/useLibraryHomeCloudTheme.ts
// 首页「AI 主题」那一屏的入口。
//
// 云端缓存里只有**歌名**（谁为哪首歌生成过主题就记一个名字），没有歌单、没有专辑 —— 所以
// 这一屏不该先给一面「歌单墙」让人再点一次：点页签就**直接进曲目列表**，那一屏自己会先把
// 云端总条数铺成占位行、再一条一条把歌搜出来填进去（见 core/services/cloudThemeCollection）。

/** 「AI 主题」那一个集合的描述（云端整个缓存就是这一屏，所以只有一个）。 */
export const buildCloudThemeCollection = (name: string): CloudGridViewCollectionDescriptor => ({
    source: 'cloud',
    id: AI_THEME_COLLECTION_ID,
    type: 'playlist',
    name,
});

/**
 * 切到「AI 主题」页签就打开那一屏，并说一句这一屏是什么。
 *
 * 只在这一次切换上开一次（openedRef）：从曲目列表返回时页签还是它，不该又被弹进去一次。
 */
export const useLibraryHomeCloudThemeEntry = ({
    tab,
    enabled = true,
    onOpenCollection,
    label,
    notice,
}: {
    tab: HomeViewTab;
    /** 首页此刻能不能交互（有弹层盖着时不开）。 */
    enabled?: boolean;
    onOpenCollection: (collection: CloudGridViewCollectionDescriptor) => void;
    /** 已翻译的页签名（渲染这一层的组件自己翻，别在这里再走一遍 i18n 的类型）。 */
    label: string;
    /** 已翻译的那句「这一屏是什么」。 */
    notice: string;
}): void => {
    const openedRef = useRef(false);
    useEffect(() => {
        if (tab !== 'cloud') {
            openedRef.current = false;
            return;
        }
        if (!enabled || openedRef.current) return;
        openedRef.current = true;
        setStatusMessage({ type: 'info', text: notice });
        onOpenCollection(buildCloudThemeCollection(label));
    }, [enabled, label, notice, onOpenCollection, tab]);
};
