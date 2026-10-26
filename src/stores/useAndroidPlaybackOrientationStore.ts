import { create } from 'zustand';
import { readNativeSettings, writeNativeSettings } from '../services/nativeSettingsBridge';

// src/stores/useAndroidPlaybackOrientationStore.ts
// 「进入可视化自动横屏」的开关状态。**真相在原生设置里**，这里只是一份供界面读的镜像。
//
// 为什么不放 localStorage：转不转屏由原生判断（PhoneLayoutOrientation.resolve），
// 它读的是原生设置（FoliaSettingsStore）。如果开关只写 localStorage，原生那份永远是
// 默认的 false —— 打开开关毫无反应。之前那版正是两边各存一份、各判一次。

type AndroidPlaybackOrientationState = {
    autoLandscapeForVisualizer: boolean;
    /** 从原生读一次；没读到时保持原状（不知道 ≠ 关掉）。 */
    hydrate: () => Promise<void>;
    setAutoLandscapeForVisualizer: (enabled: boolean) => Promise<void>;
};

export const useAndroidPlaybackOrientationStore = create<AndroidPlaybackOrientationState>((set, get) => ({
    autoLandscapeForVisualizer: false,
    hydrate: async () => {
        const settings = await readNativeSettings();
        if (!settings) return;
        set({ autoLandscapeForVisualizer: settings.autoLandscapeForVisualizer === true });
    },
    setAutoLandscapeForVisualizer: async (enabled) => {
        // 先按用户点的样子显示（这是人手点的，不该有延迟感），再以原生返回的为准。
        set({ autoLandscapeForVisualizer: enabled });
        const merged = await writeNativeSettings({ autoLandscapeForVisualizer: enabled });
        if (!merged) {
            // 写失败就退回原状 —— 停在「看起来开了」是最坏的结果。
            set({ autoLandscapeForVisualizer: !enabled });
            return;
        }
        set({ autoLandscapeForVisualizer: merged.autoLandscapeForVisualizer === true });
        // 开关刚改，让原生立刻按新设置重算一次方向（进/出播放页时它也会重算）。
        void refreshNativeOrientation(get().autoLandscapeForVisualizer);
    },
}));

/**
 * 让原生按当前设置重算方向。**只报「在不在播放页」，不报「该不该转」**：
 * 判定全部留在原生，Web 说多了就会与它分歧。
 */
export const refreshNativeOrientation = async (playerVisible: boolean): Promise<void> => {
    if (typeof window === 'undefined') return;
    const g = window as unknown as {
        Capacitor?: { getPlatform?: () => string; Plugins?: Record<string, unknown> };
    };
    if (g.Capacitor?.getPlatform?.() !== 'android') return;
    const plugin = g.Capacitor.Plugins?.FoliaNative as
        | { setPlayerVisible?: (o: { visible: boolean }) => Promise<unknown> }
        | undefined;
    if (!plugin?.setPlayerVisible) return;
    try {
        await plugin.setPlayerVisible({ visible: playerVisible });
    } catch (error) {
        console.warn('[nativeOrientation] 上报播放页可见性失败', error);
    }
};
