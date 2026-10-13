import { describe, expect, it } from 'vitest';
import {
    buildLyricSourceOrder,
    DEFAULT_LYRIC_SOURCE_PREFERENCE,
    LYRIC_SOURCE_PREFERENCE_ORDER,
    migratePreferredLyricSource,
} from '@/utils/lyrics/sourcePriority';

// test/unit/lyrics/sourcePriority.test.ts

describe('lyric source priority', () => {
    it('defaults to QQ and retains every fallback exactly once', () => {
        expect(buildLyricSourceOrder()).toEqual(['qq', 'netease', 'amll', 'kugou']);
        expect(buildLyricSourceOrder('kugou')).toEqual(['kugou', 'netease', 'amll', 'qq']);
        expect(buildLyricSourceOrder('netease')).toEqual(['netease', 'amll', 'qq', 'kugou']);
        expect(buildLyricSourceOrder('amll')).toEqual(['amll', 'netease', 'qq', 'kugou']);
    });

    // 没改过这项的人（含升级上来的）现在是「跟随播放平台来源」：在线歌按自己所在平台取。
    it('migrates missing, invalid, and legacy NetEase preferences to following the playback source', () => {
        expect(DEFAULT_LYRIC_SOURCE_PREFERENCE).toBe('follow-source');
        expect(migratePreferredLyricSource(null, null)).toBe('follow-source');
        expect(migratePreferredLyricSource(null, 'netease')).toBe('follow-source');
        expect(migratePreferredLyricSource(null, 'invalid')).toBe('follow-source');
        expect(migratePreferredLyricSource('invalid', 'kugou')).toBe('follow-source');
    });

    it('preserves other legacy values and trusts the versioned preference thereafter', () => {
        expect(migratePreferredLyricSource(null, 'amll')).toBe('amll');
        expect(migratePreferredLyricSource(null, 'qq')).toBe('qq');
        expect(migratePreferredLyricSource(null, 'kugou')).toBe('kugou');
        expect(migratePreferredLyricSource('netease', 'qq')).toBe('netease');
        expect(migratePreferredLyricSource('follow-source', null)).toBe('follow-source');
    });

    it('offers follow-playback first and every real source exactly once', () => {
        expect(LYRIC_SOURCE_PREFERENCE_ORDER[0]).toBe('follow-source');
        expect([...LYRIC_SOURCE_PREFERENCE_ORDER].sort()).toEqual(
            ['amll', 'follow-source', 'kugou', 'netease', 'qq'].sort(),
        );
    });
});
