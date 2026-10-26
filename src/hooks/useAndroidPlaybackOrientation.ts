import { useEffect } from 'react';
import { useAppViewStore } from '../stores/useAppViewStore';
import {
    refreshNativeOrientation,
    useAndroidPlaybackOrientationStore,
} from '../stores/useAndroidPlaybackOrientationStore';
import { isCapacitorAndroid } from '../platform/runtime';

// src/hooks/useAndroidPlaybackOrientation.ts
// 把「现在在不在播放页」告诉原生，让原生按设置决定要不要转屏。
//
// **Web 只说事实，不替原生做判断**：转不转由 PhoneLayoutOrientation.resolve 按
// 「进入可视化自动横屏」这个设置与实际所在页面算。之前那版是 Web 自己判（还要
// 落盘方向必须是竖屏），真机上开了开关毫无反应 —— 两处各判一次就是这样分歧的。
//
// 启动时先 hydrate 一次开关状态，界面才不会显示成关着。

export const useAndroidPlaybackOrientation = (): void => {
    const view = useAppViewStore(state => state.view);
    const hydrate = useAndroidPlaybackOrientationStore(state => state.hydrate);

    useEffect(() => {
        if (!isCapacitorAndroid()) return;
        void hydrate();
    }, [hydrate]);

    useEffect(() => {
        if (!isCapacitorAndroid()) return;
        // 只有播放页要横屏；其它页面一律「不在播放页」，让它把方向还回去。
        void refreshNativeOrientation(view === 'player');
    }, [view]);
};
