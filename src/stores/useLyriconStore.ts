import { create } from 'zustand';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';
import { getLyriconStatus, setLyriconEnabled, setLyriconLinkEnabled } from '../platform/foliaLyricon';

// src/stores/useLyriconStore.ts
// 状态栏歌词（folia状态栏）的开关与连接状态。
//
// 开关本身落在 localStorage：它是个用户偏好，跟账号无关，也不该每次启动都被重置。
// 「有没有连上」是运行时状态，只有真正去注册一次才知道，所以另外存一份。

const LYRICON_ENABLED_STORAGE_KEY = 'folia.lyriconEnabled';
const LYRICON_LINK_STORAGE_KEY = 'folia.lyriconLink';

type LyriconState = {
    enabled: boolean;
    /**
     * 免 Root 直连握手的独立开关（默认开）。
     *
     * 关掉就只剩 SDK 单向的注册广播：能连上就连，连不上也不会去主动问。
     */
    link: boolean;
    /** 中心服务是否真的连上了。false 多半意味着设备上没装 folia状态栏。 */
    connected: boolean;
    handleToggleLyricon: (enable: boolean) => void;
    handleToggleLyriconLink: (enable: boolean) => void;
    /** 启动时把开关同步给原生，并问一次连接状态。 */
    syncLyriconStatus: () => void;
};

export const useLyriconStore = create<LyriconState>((set, get) => ({
    enabled: getStoredBoolean(LYRICON_ENABLED_STORAGE_KEY, false),
    link: getStoredBoolean(LYRICON_LINK_STORAGE_KEY, true),
    connected: false,
    handleToggleLyricon: (enable) => {
        setStoredBoolean(LYRICON_ENABLED_STORAGE_KEY, enable);
        set({ enabled: enable });
        void setLyriconEnabled(enable).then((result) => {
            // 注册失败（没装 Lyricon / 版本不兼容）时把开关弹回去，
            // 免得界面一直显示「已开启」而状态栏什么都没有。
            if (enable && !result.connected) {
                set({ connected: false });
                return;
            }
            set({ connected: result.connected });
        });
    },
    handleToggleLyriconLink: (enable) => {
        setStoredBoolean(LYRICON_LINK_STORAGE_KEY, enable);
        set({ link: enable });
        void setLyriconLinkEnabled(enable).then((result) => {
            set({ connected: result.connected });
        });
    },
    syncLyriconStatus: () => {
        const enabled = get().enabled;
        void setLyriconEnabled(enabled).then((result) => {
            set({ connected: result.connected });
        });
        void setLyriconLinkEnabled(get().link).then((result) => {
            set({ connected: result.connected });
        });
        void getLyriconStatus().then((result) => {
            set({ connected: result.connected, link: result.link });
        });
    },
}));
