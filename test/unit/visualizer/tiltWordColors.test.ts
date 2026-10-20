import { describe, expect, it } from 'vitest';
import type { Theme } from '@/types';
import { buildWordColorRanges } from '@/components/visualizer/wordColoring';
import {
    buildTiltLineColorRanges,
    resolveTiltGraphemeColors,
    type TiltGrapheme,
} from '@/components/visualizer/tilt/tiltWordColors';

// test/unit/visualizer/tiltWordColors.test.ts
// 倾诉的逐字取色守的是一件事：AI 主题的 `wordColors` 得看得见。
//
// 倾诉把一整行切成一到四段来排，每段是行的子串、带着自己在整行里的起点（`charOffset`）。
// 以前颜色是**按段**拍的，一段一个平色 —— 于是整行都成了主题色，AI 给关键字挑的颜色
// 一条都看不见（App 内与桌面叠层走同一条渲染路径，所以两处一起坏）。

const FALLBACK = '#ffffff';

const theme = (wordColors: { word: string; color: string; }[]): Theme => ({
    wordColors,
} as unknown as Theme);

const graphemeAt = (text: string): TiltGrapheme[] => (
    [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)]
        .map(item => ({ segment: item.segment, index: item.index }))
);

describe('tilt word colors', () => {
    it('falls back to the segment color when the theme names no keyword', () => {
        const graphemes = graphemeAt('天空之城');
        const colors = resolveTiltGraphemeColors(graphemes, 0, [], FALLBACK);
        expect(colors).toEqual([FALLBACK, FALLBACK, FALLBACK, FALLBACK]);
    });

    it('colors only the characters inside the keyword', () => {
        const fullText = '天空之城';
        const ranges = buildTiltLineColorRanges(fullText, theme([{ word: '天空', color: '#0000ff' }]).wordColors);

        const colors = resolveTiltGraphemeColors(graphemeAt(fullText), 0, ranges, FALLBACK);

        // 关键字只覆盖前两个字，后面照旧是兜底色 —— 一眼能看出"这段被标了色"。
        expect(colors).toEqual(['#0000ff', '#0000ff', FALLBACK, FALLBACK]);
    });

    it('reads the ranges in whole-line coordinates, not segment coordinates', () => {
        // 整行是「我看见天空之城」，这一段是后半截，起点偏移 3。
        // 区间是在**整行**上算的，段内下标得加上这个偏移去查，否则会整段错位。
        const fullText = '我看见天空之城';
        const ranges = buildTiltLineColorRanges(fullText, theme([{ word: '天空', color: '#0000ff' }]).wordColors);
        expect(ranges).toEqual([{ startOffset: 3, endOffset: 5, color: '#0000ff', priority: 2 }]);

        const colors = resolveTiltGraphemeColors(graphemeAt('天空之城'), 3, ranges, FALLBACK);

        expect(colors).toEqual(['#0000ff', '#0000ff', FALLBACK, FALLBACK]);
    });

    it('leaves the same characters alone when they are not a contiguous keyword', () => {
        // 「天」「空」都在，但没挨在一起 —— 区间要求关键字**连着出现**，散落的不上色。
        const fullText = '天是空的';
        const ranges = buildTiltLineColorRanges(fullText, theme([{ word: '天空', color: '#0000ff' }]).wordColors);
        expect(ranges).toEqual([]);

        const colors = resolveTiltGraphemeColors(graphemeAt(fullText), 0, ranges, FALLBACK);
        expect(colors.every(color => color === FALLBACK)).toBe(true);
    });

    it('colors every occurrence of a keyword that repeats in the line', () => {
        const fullText = '我们的天空也不是天空';
        const ranges = buildWordColorRanges(fullText, theme([{ word: '天空', color: '#0000ff' }]).wordColors);
        expect(ranges).toHaveLength(2);

        const colors = resolveTiltGraphemeColors(graphemeAt(fullText), 0, ranges, FALLBACK);
        const highlighted = colors
            .map((color, index) => (color === '#0000ff' ? fullText[index] : ''))
            .join('');

        expect(highlighted).toBe('天空天空');
    });

    it('returns an empty list for an empty line', () => {
        expect(buildTiltLineColorRanges('', [{ word: '天空', color: '#0000ff' }])).toEqual([]);
    });
});
