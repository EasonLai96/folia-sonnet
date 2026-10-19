import { useCallback, useEffect, useRef } from 'react';
import type { HomeViewTab } from '../../../types';
import { AI_THEME_COLLECTION_ID, type CloudGridViewCollectionDescriptor } from '../collection/collection.contract';
import { collectionKey } from '../collection/collectionIdentity';
import { getActiveGridViewCollection } from '../collection/collectionNavigation';
import { useCollectionNavigationStore } from '../../../stores/useCollectionNavigationStore';
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

/** 这一屏的集合身份键（只有一个，且不含随名字变的字段 —— 名字是翻译，会随语言变）。 */
const AI_THEME_KEY = collectionKey({
    source: 'cloud',
    id: AI_THEME_COLLECTION_ID,
    type: 'playlist',
});

/**
 * 切到「AI 主题」页签就打开那一屏，并说一句这一屏是什么。
 *
 * ⭐ 打开这件事必须**幂等**，判据存在 store 而不是组件里。
 *
 * 它是个根集合（navigateToCollection → openRoot），每开一次就往浏览器历史压一条记录。
 * 而它又是切页签时由 effect 自动开的 —— 于是首页一重挂（切 view 回来、切 suite、弹层开合导致的
 * 重挂载），ref 就归零、就再压一条。栈里堆着好几层一模一样的 AI 主题，点返回落到的是**上一个
 * AI 主题**：画面纹丝不动，看上去就是「返回按了没用、退不到主界面」。
 *
 * 所以判据读导航栈本身（它跨重挂载活着）：已经在看这一屏就直接不做。
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
    const open = useCallback(() => {
        // 已经在看这一屏就什么都不做：再开一次等于再压一层历史（后果见上面的说明）。
        const active = getActiveGridViewCollection(useCollectionNavigationStore.getState().snapshot);
        if (active && collectionKey(active) === AI_THEME_KEY) return;
        setStatusMessage({ type: 'info', text: notice });
        onOpenCollection(buildCloudThemeCollection(label));
    }, [label, notice, onOpenCollection]);

    useEffect(() => {
        if (tab !== 'cloud') {
            openedRef.current = false;
            return;
        }
        if (!enabled || openedRef.current) return;
        openedRef.current = true;
        open();
    }, [enabled, open, tab]);
};
