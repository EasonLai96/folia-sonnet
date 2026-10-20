import type { Theme } from '../../../types';
import { buildWordColorRanges, type WordColorRange } from '../wordColoring';

// src/components/visualizer/tilt/tiltWordColors.ts
// 倾诉的逐字取色：与磁贴 / 莫奈 / claddagh 共用同一套「整行算区间」的规矩。
//
// 为什么非要逐字：倾诉把**一整行**切成一到四段来排，而渲染是**逐字**的 —— 每段刷一个平色
// 的话，整行就只剩主题色，AI 主题给那些关键字挑的颜色一条都看不见。播放页那几个样式
// （classic / cadenza / fume）都是逐词过一遍 `resolveWordColor`，所以那边有高亮、这边一条
// 都没有。这里给每段按「字在整行里的下标」查区间，命中的字上关键字自己的颜色。

/** `Intl.Segmenter` 切出来的一个字：`index` 是它在**本段文本**里的码元下标。 */
export interface TiltGrapheme {
    segment: string;
    index: number;
}

/**
 * 整行只算一次关键字上色区间。
 *
 * 段是行切出来的子串，各自的 `charOffset` 就是它在整行里的起点，于是每段拿同一份区间、
 * 按自己的偏移去查就行 —— 与 `findSegmentWordRange` 用的是同一个坐标系。
 */
export const buildTiltLineColorRanges = (
    fullText: string,
    wordColors: Theme['wordColors'],
): WordColorRange[] => (
    fullText ? buildWordColorRanges(fullText, wordColors) : []
);

/**
 * 给一段里的每个字定颜色：落在关键字区间里的用关键字自己的颜色，其余用 `fallbackColor`
 * （正常段 / 倾斜段各一个兜底色，见 `VisualizerTilt` 的 `getColors`）。
 *
 * 区间互不重叠且已按起点排好序（见 `selectNonOverlappingRanges`），所以查到第一个就够。
 */
export const resolveTiltGraphemeColors = (
    graphemes: TiltGrapheme[],
    charOffset: number,
    ranges: WordColorRange[],
    fallbackColor: string,
): string[] => {
    if (!ranges || ranges.length === 0) {
        return graphemes.map(() => fallbackColor);
    }

    return graphemes.map((grapheme) => {
        const startOffset = charOffset + grapheme.index;
        const endOffset = startOffset + grapheme.segment.length;
        const hit = ranges.find(range => startOffset < range.endOffset && range.startOffset < endOffset);
        return hit?.color ?? fallbackColor;
    });
};
