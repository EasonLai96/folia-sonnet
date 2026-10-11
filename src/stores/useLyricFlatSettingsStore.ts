import { create } from 'zustand';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';

// src/stores/useLyricFlatSettingsStore.ts
// 播放页歌词的「扁平化」：去掉发光，渐变染色的字改成纯色。
//
// 歌词的画法按可视化模式分在好几个渲染器里（每个模式都有自己的一套高亮、光晕和渐变），
// 逐个去读开关既改不完也容易漏，所以这里只负责把开关写到 <html data-lyric-flat>，
// 具体长什么样由 CSS 在一个作用域内统一覆盖 —— 见 index.css 里那段。

const LYRICS_FLAT_KEY = 'folia_lyrics_flat';

export type LyricFlatSettingsState = {
    flatLyrics: boolean;
    setFlatLyrics: (enabled: boolean) => void;
};

export const useLyricFlatSettingsStore = create<LyricFlatSettingsState>((set) => ({
    // 默认关：发光和渐变是 Folia 歌词的本来样子。
    flatLyrics: getStoredBoolean(LYRICS_FLAT_KEY, false),
    setFlatLyrics: (enabled) => {
        setStoredBoolean(LYRICS_FLAT_KEY, enabled);
        set({ flatLyrics: enabled });
    },
}));

const syncLyricFlatAttribute = (enabled: boolean): void => {
    if (typeof document === 'undefined' || !document.documentElement) return;
    if (enabled) {
        document.documentElement.setAttribute('data-lyric-flat', '1');
    } else {
        document.documentElement.removeAttribute('data-lyric-flat');
    }
};

syncLyricFlatAttribute(useLyricFlatSettingsStore.getState().flatLyrics);
useLyricFlatSettingsStore.subscribe(state => syncLyricFlatAttribute(state.flatLyrics));
