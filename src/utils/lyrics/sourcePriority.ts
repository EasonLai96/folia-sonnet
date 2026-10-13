import type { LyricProviderSource, LyricSourcePreference } from '../../types';

// src/utils/lyrics/sourcePriority.ts

// 「没有偏好」时用的兜底顺序（buildLyricSourceOrder 的默认参数）。改这个会动到所有
// 没传 preferredSource 的匹配路径，别和下面「设置项的默认值」混为一谈。
export const DEFAULT_PREFERRED_LYRIC_SOURCE: LyricProviderSource = 'qq';

const BASE_LYRIC_SOURCE_ORDER: readonly LyricProviderSource[] = ['netease', 'amll', 'qq', 'kugou'];

// 设置项「歌词匹配优先级」新增的取值：跟随播放平台来源。
// 必须留成字面量类型：靠 `preference !== LYRIC_SOURCE_FOLLOW_PLAYBACK` 收窄出具体平台，
// 一旦这里被放宽成 LyricSourcePreference，那个判断就窄不动了。
export const LYRIC_SOURCE_FOLLOW_PLAYBACK = 'follow-source' as const;

// 新装 / 没改过这项的默认值。
export const DEFAULT_LYRIC_SOURCE_PREFERENCE: LyricSourcePreference = LYRIC_SOURCE_FOLLOW_PLAYBACK;

// 设置项「本地歌曲的歌词来源」的默认值。本地文件自己没有平台，只能定一个。
export const DEFAULT_LOCAL_LYRIC_SOURCE: LyricProviderSource = 'qq';

export const isLyricProviderSource = (value: unknown): value is LyricProviderSource => (
    value === 'netease' || value === 'amll' || value === 'qq' || value === 'kugou'
);

export const isLyricSourcePreference = (value: unknown): value is LyricSourcePreference => (
    value === LYRIC_SOURCE_FOLLOW_PLAYBACK || isLyricProviderSource(value)
);

// 设置面板里那一格的候选顺序：跟随播放平台排在最前，其余沿用兜底顺序。
export const LYRIC_SOURCE_PREFERENCE_ORDER: readonly LyricSourcePreference[] = [
    LYRIC_SOURCE_FOLLOW_PLAYBACK,
    ...BASE_LYRIC_SOURCE_ORDER,
];

// Places the user preference first while retaining every fallback source exactly once.
export const buildLyricSourceOrder = (
    preferredSource: LyricProviderSource = DEFAULT_PREFERRED_LYRIC_SOURCE,
): LyricProviderSource[] => [
    preferredSource,
    ...BASE_LYRIC_SOURCE_ORDER.filter(source => source !== preferredSource),
];

export const migratePreferredLyricSource = (
    versionedValue: unknown,
    legacyValue: unknown,
): LyricSourcePreference => {
    if (versionedValue !== null && versionedValue !== undefined) {
        return isLyricSourcePreference(versionedValue) ? versionedValue : DEFAULT_LYRIC_SOURCE_PREFERENCE;
    }
    // 旧键只存过具体平台，没有「跟随播放平台」这个值。
    if (legacyValue === 'amll' || legacyValue === 'qq' || legacyValue === 'kugou') return legacyValue;
    return DEFAULT_LYRIC_SOURCE_PREFERENCE;
};
