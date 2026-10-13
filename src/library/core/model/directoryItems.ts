import type { LibraryDirectoryItem } from '../contracts/directory';
import { scopeCardId } from './onlineProviderScope';

// src/library/core/model/directoryItems.ts
// 首页卡片 → 目录条目，以及目录条目上「路径」那一格写什么。网格的 GridMap 与 TUI 的目录列表共用这两条规则，
// 两套 UI 对同一个条目显示同一段文字：
// - 文件夹卡的描述是它的名称（路径）——虚拟的「全部歌曲」也一样；path 只给真实文件夹（契约：虚拟条目没有路径）。
// - 路径的位置：真实文件夹是路径，虚拟文件夹（「全部歌曲」）放它的名称（P3.1 之前一直这样显示，P3.1 保留
//   isVirtual 后丢过一次，网格的 gridMapCardText 与这里同一条规则）。

type HomeCardLike = {
    id: string | number;
    name: string;
    type?: string;
    coverUrl?: string;
    description?: string;
    summary?: string;
    trackCount?: number;
    trackIds?: string[];
    isVirtual?: boolean;
    /** 「全部」视图里这张卡来自哪家（见 contracts/homeModel 的 LibraryHomeCard.sourceProviderId）。 */
    sourceProviderId?: string;
};

/**
 * 首页卡片在目录里的样子（GridMap 的条目、TUI 的一行）。
 *
 * 合了各家歌单之后不同平台的歌单 id 会撞（都是数字），条目的 id 按平台分开：
 * 它们是隐藏表、批选、墙上条目的身份，撞了会出现「隐藏 A 家的歌单、B 家同 id 的那张也跟着藏了」。
 */
export const homeCardToDirectoryItem = (card: HomeCardLike): LibraryDirectoryItem => {
    const isFolder = card.type === 'folder';
    return {
        id: card.sourceProviderId ? scopeCardId(card.sourceProviderId, card.id) : card.id,
        name: card.name,
        coverUrl: card.coverUrl,
        description: isFolder ? card.name : card.description,
        summary: card.summary,
        trackCount: card.trackCount,
        type: card.type,
        path: isFolder && !card.isVirtual ? card.name : undefined,
        trackIds: card.trackIds,
        isVirtual: card.isVirtual,
    };
};

/** 文件夹条目占「路径」位置的文字：真实文件夹是路径，虚拟文件夹是名称；不是文件夹为空串。 */
export const resolveDirectoryFolderLabel = (
    item: Pick<LibraryDirectoryItem, 'type' | 'path' | 'name' | 'isVirtual'>,
): string => {
    if (item.type !== 'folder') return '';
    return item.path || (item.isVirtual ? item.name : '');
};
