import type { Line } from '../../../../types';
import { buildMonetDisplayTokens, splitMonetGraphemes, type MonetDisplayToken } from '../../../visualizer/monet/monetLyricsModel';
import { resolveThemeFontStack, resolveThemeTranslationFontStack, resolveThemeFontWeight } from '../../../../utils/fontStacks';
import { buildLineGraphemeTimeline, splitLyricGraphemes } from '../../../../utils/lyrics/graphemeTiming';
import { getLineRenderEndTime } from '../../../../utils/lyrics/renderHints';
import { segmentLyricWords } from '../../../../utils/lyrics/wordSegmentation';
import type { LatticeLyricInput } from './types';
import { resolveMonetFillWidth } from '../../../visualizer/monet/monetLyricMotion';

// src/components/app/lattice/lyrics/latticeLyricLayout.ts
export type MeasureText = (text: string, font: string) => { width: number; height: number };
export const showsLatticeTranslation = (input: LatticeLyricInput) =>
    input.showSubtitleTranslation !== false && !input.hideTranslationSubtitle && input.subtitleContentMode !== 'none';

/** Fits a fixed lyric budget, never the current sentence, so line changes cannot pump the font size. */
export function resolveLatticeTypography(input: LatticeLyricInput, width: number, height: number, measure: MeasureText) {
    const family = resolveThemeFontStack(input.theme);
    const translationFamily = resolveThemeTranslationFontStack(input.subtitleTheme ?? input.theme);
    const weight = resolveThemeFontWeight(input.theme, 600);
    const translationWeight = resolveThemeFontWeight(input.subtitleTheme ?? input.theme, 500);
    const showTranslation = showsLatticeTranslation(input);
    let fontPx = 24;
    for (let size = 64; size >= 24; size--) {
        const main = measure('国Agyp', `${weight} ${size}px ${family}`);
        const sub = measure('国Agyp', `${translationWeight} ${size * 0.5}px ${translationFamily}`);
        const lineHeight = Math.max(size * 1.18, main.height + 2);
        const budget = lineHeight * (3 + 2 * 0.72) + size * 0.49 * 2 + size * 1.2
            + (showTranslation ? Math.max(size * 0.5 * 1.35, sub.height + 2) * 2 + size * 0.3 : 0);
        if (budget <= height && main.width * 3 <= Math.max(0, width - size * 1.2)) { fontPx = size; break; }
    }
    const font = `${weight} ${fontPx}px ${family}`;
    const translationPx = fontPx * 0.5;
    const translationFont = `${translationWeight} ${translationPx}px ${translationFamily}`;
    return { fontPx, font, translationPx, translationFont, showTranslation,
        lineHeight: Math.max(fontPx * 1.18, measure('国Agyp', font).height + 2),
        translationLineHeight: Math.max(translationPx * 1.35, measure('国Agyp', translationFont).height + 2),
        padding: Math.ceil(fontPx * 0.6) };
}
export type LatticeTypography = ReturnType<typeof resolveLatticeTypography>;
export interface LyricPiece {
    text: string; x: number; y: number; width: number; row: number;
    token: MonetDisplayToken; offsets: number[]; tokenOffset: number; translation: boolean;
}

/** Wraps at token boundaries; oversized tokens split only at grapheme boundaries, preserving their clock offsets. */
export function wrapLatticeTokens(tokens: MonetDisplayToken[], width: number, font: string,
    lineHeight: number, measure: MeasureText, translation = false): LyricPiece[] {
    const pieces: LyricPiece[] = [];
    let x = 0, row = 0;
    for (const token of tokens) {
        const glyphs = splitMonetGraphemes(token.text);
        const offsets = [0];
        for (let i = 1; i <= glyphs.length; i++) offsets.push(measure(glyphs.slice(0, i).join(''), font).width);
        const fullWidth = offsets.at(-1) ?? 0;
        if (!token.text.includes('\n') && x > 0 && x + fullWidth > width) { row++; x = 0; }
        let first = 0;
        while (first < glyphs.length) {
            if (glyphs[first] === '\n') { row++; x = 0; first++; continue; }
            let last = first + 1;
            while (last < glyphs.length && glyphs[last] !== '\n'
                && measure(glyphs.slice(first, last + 1).join(''), font).width + x <= width) last++;
            const text = glyphs.slice(first, last).join('');
            const pieceWidth = measure(text, font).width;
            pieces.push({ text, x, y: row * lineHeight, width: pieceWidth, row, token, offsets,
                tokenOffset: offsets[first], translation });
            x += pieceWidth;
            first = last;
            if (first < glyphs.length && glyphs[first] !== '\n') { row++; x = 0; }
        }
    }
    return pieces;
}

/*
 * 没有逐字时间的行（普通 LRC）在 Monet 的 token 化里是「一整行一个 token」，于是整行只能有
 * 一个颜色 —— AI 主题按词标记的高亮色在磁贴墙上一个都落不上，看过去就是整行一个色。
 *
 * 播放页那些样式（classic / cadenza / fume）不是这么切的：它们把行切成词再逐词取色。这里按
 * 同一份分词（segmentLyricWords，认用户手改过的 wordSegments 与 icu-folia 烘上去的
 * autoWordSegments）把整行切成词级 token，时间沿用整行那条逐字时间线按词切片 —— 扫光、
 * 换行都照旧，只是每个词能自己拿一个颜色。
 */
function buildLatticeLineTokens(line: Line): MonetDisplayToken[] {
    if (line.words.length > 0) {
        return buildMonetDisplayTokens(line);
    }

    const graphemes = splitLyricGraphemes(line.fullText);
    if (graphemes.length === 0) {
        return buildMonetDisplayTokens(line);
    }

    // 分词给的是「字符下标」，而扫光要的是「字素下标」，两者在 emoji / 组合字符上不是一回事。
    const graphemeAt = new Int32Array(line.fullText.length);
    let cursor = 0;
    for (let index = 0; index < graphemes.length; index++) {
        for (let offset = 0; offset < graphemes[index].length; offset++) {
            graphemeAt[cursor + offset] = index;
        }
        cursor += graphemes[index].length;
    }

    const timeline = buildLineGraphemeTimeline(line);
    const tokens: MonetDisplayToken[] = [];
    for (const segment of segmentLyricWords(line)) {
        const endChar = segment.index + segment.segment.length;
        if (endChar <= segment.index) continue;
        const first = graphemeAt[segment.index] ?? 0;
        const last = graphemeAt[endChar - 1] ?? first;
        const slice = timeline.slice(first, last + 1);
        tokens.push({
            text: segment.segment,
            startTime: slice[0]?.startTime ?? line.startTime,
            endTime: slice[slice.length - 1]?.endTime ?? line.endTime,
            key: `${line.startTime}-word-${segment.index}`,
            timed: true,
            startOffset: segment.index,
            endOffset: endChar,
            graphemeTimings: slice,
        });
    }
    if (tokens.length === 0) {
        return buildMonetDisplayTokens(line);
    }

    // 最后一个词的收尾时间跟着整行的「渲染结束时间」走（renderHints 会把它推后），
    // 与以前「整行一个 token」时 end = getLineRenderEndTime(line) 的行为一致。
    const renderEnd = getLineRenderEndTime(line);
    const tail = tokens[tokens.length - 1];
    if (renderEnd > tail.endTime) {
        tokens[tokens.length - 1] = { ...tail, endTime: renderEnd };
    }

    return tokens;
}

export function layoutLatticeLine(line: Line, type: LatticeTypography, width: number, measure: MeasureText,
    romanization: boolean) {
    const tokens = buildLatticeLineTokens(line);
    const pieces = wrapLatticeTokens(tokens, width, type.font, type.lineHeight, measure);
    const rows = (pieces.at(-1)?.row ?? 0) + 1;
    const translation = type.showTranslation ? (romanization ? line.romanization : line.translation) : '';
    const subToken: MonetDisplayToken = { text: translation ?? '', timed: false, startTime: null, endTime: null,
        key: 'translation', startOffset: 0, endOffset: translation?.length ?? 0, graphemeTimings: [] };
    const sub = translation ? wrapLatticeTokens([subToken], width, type.translationFont, type.translationLineHeight, measure, true)
        .filter(piece => piece.row < 2) : [];
    const textHeight = rows * type.lineHeight;
    for (const piece of sub) piece.y += textHeight + type.fontPx * 0.3;
    return { pieces: [...pieces, ...sub], rows, textHeight,
        height: textHeight + (sub.length ? type.fontPx * 0.3 + ((sub.at(-1)?.row ?? 0) + 1) * type.translationLineHeight : 0) };
}
export type LatticeLineLayout = ReturnType<typeof layoutLatticeLine>;

/** Follows the timed row in an oversized active block without changing font size or dropping text. */
export function resolveLatticeLongLineOffset(layout: LatticeLineLayout, time: number, available: number, lineHeight: number) {
    if (layout.height <= available) return 0;
    const timed = layout.pieces.filter(p => !p.translation && p.token.timed);
    let active = timed[0];
    for (const piece of timed) {
        const start = piece.token.startTime ?? Infinity, end = piece.token.endTime ?? Infinity;
        if (time < start) break;
        const front = resolveMonetFillWidth(time, start, end, piece.offsets, piece.token.graphemeTimings);
        if (front >= piece.tokenOffset) active = piece;
        if (time <= end && front < piece.tokenOffset + piece.width) break;
    }
    return Math.min(Math.max(0, layout.height - available), Math.max(0, (active?.y ?? 0) - available * 0.46 + lineHeight / 2));
}
