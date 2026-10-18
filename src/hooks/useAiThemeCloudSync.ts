import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { isFoliaCloudCacheEnabled } from '../services/foliaCloud';
import {
    aiThemeSongRefOf,
    clearLocalAiThemeOverride,
    pullAiThemeFromCloud,
    pushAiThemeToCloud,
} from '../services/aiThemeCloud';
import { applyAiThemeFromOutside, readCurrentAiTheme } from '../services/aiThemeApplyBridge';
import { setStatusMessage } from '../stores/useStatusMessageStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';

// src/hooks/useAiThemeCloudSync.ts
// 面板上「AI 主题」旁边那颗同步按钮：走 AI 云缓存（kind='theme'），不碰自建 sync 服务器。
//
// 一个按钮两个方向，按**本机有没有改过**分：
//   · 改过 → 把本机这一版推上去（云端那条是 upsert，改完再点是幂等的）；
//   · 没改过 → 从云端拉一版下来当场用上。
// 于是「我在这台机上调好的颜色，换台机也能拿到」和「别人做好的我直接拿来用」
// 两个方向共用一颗按钮，不需要用户先想清楚自己是要上传还是下载。
//
// 另外给「恢复云端版本」：丢掉本机这一版，重新用云端的 —— 改坏了有退路。

export type AiThemeCloudSyncState = 'idle' | 'syncing' | 'complete';

const COMPLETE_STATE_HOLD_MS = 1600;

export const useAiThemeCloudSync = (options: {
    /** 本机改过的那一版还在不在（面板的 `themeSourceModel.hasLocalAiTheme`）。 */
    locallyEdited: boolean;
}) => {
    const { locallyEdited } = options;
    const { t } = useTranslation();
    const [syncState, setSyncState] = useState<AiThemeCloudSyncState>('idle');
    const completeTimerRef = useRef<number | null>(null);
    const currentSong = usePlaybackStore(useShallow(state => state.currentSong));

    useEffect(() => () => {
        if (completeTimerRef.current !== null) {
            window.clearTimeout(completeTimerRef.current);
        }
    }, []);

    const holdComplete = useCallback(() => {
        if (completeTimerRef.current !== null) {
            window.clearTimeout(completeTimerRef.current);
        }
        setSyncState('complete');
        completeTimerRef.current = window.setTimeout(() => {
            setSyncState('idle');
            completeTimerRef.current = null;
        }, COMPLETE_STATE_HOLD_MS);
    }, []);

    const runSync = useCallback(async () => {
        if (syncState === 'syncing') {
            return;
        }
        if (!currentSong) {
            return;
        }
        if (!isFoliaCloudCacheEnabled()) {
            setStatusMessage({ type: 'info', text: t('ui.aiThemeCloudOff') });
            return;
        }

        const songRef = aiThemeSongRefOf(currentSong);
        setSyncState('syncing');
        try {
            /*
             * 推上去的内容现在才问：面板那一行拿到的是按当前明暗挑出来的一半，
             * 而云端存的是整份（浅 + 深）—— 见 aiThemeApplyBridge。
             */
            const theme = readCurrentAiTheme();
            if (locallyEdited && theme) {
                const pushed = await pushAiThemeToCloud(songRef, theme);
                setStatusMessage({
                    type: pushed ? 'success' : 'info',
                    text: t(pushed ? 'ui.aiThemeCloudPushed' : 'ui.aiThemeCloudPushFailed'),
                });
                holdComplete();
                return;
            }

            const pulled = await pullAiThemeFromCloud(songRef);
            if (pulled && applyAiThemeFromOutside(pulled)) {
                setStatusMessage({ type: 'success', text: t('ui.aiThemeCloudPulled') });
            } else {
                setStatusMessage({ type: 'info', text: t('ui.aiThemeCloudMiss') });
            }
        } finally {
            holdComplete();
        }
    }, [currentSong, holdComplete, locallyEdited, syncState, t]);

    /** 「恢复云端版本」：丢掉本机改的这一版，把云端的拉回来用。 */
    const restoreCloudVersion = useCallback(async () => {
        if (syncState === 'syncing' || !currentSong) {
            return;
        }
        if (!isFoliaCloudCacheEnabled()) {
            setStatusMessage({ type: 'info', text: t('ui.aiThemeCloudOff') });
            return;
        }

        const songRef = aiThemeSongRefOf(currentSong);
        setSyncState('syncing');
        try {
            await clearLocalAiThemeOverride(songRef);
            const pulled = await pullAiThemeFromCloud(songRef);
            if (pulled && applyAiThemeFromOutside(pulled)) {
                setStatusMessage({ type: 'success', text: t('ui.aiThemeCloudRestored') });
            } else {
                setStatusMessage({ type: 'info', text: t('ui.aiThemeCloudMiss') });
            }
        } finally {
            holdComplete();
        }
    }, [currentSong, holdComplete, syncState, t]);

    return { syncState, runSync, restoreCloudVersion };
};

export default useAiThemeCloudSync;
