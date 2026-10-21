import type { Line } from '../../../types';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { segmentLyricWords } from '../../../utils/lyrics/wordSegmentation';
import { segmentWithVocab } from './promptSegments';

// src/components/visualizer/prompt/promptProgram.ts
// 歌词 → 节目单：一句一个框。纯函数，不碰 pixi、不碰运行时 —— 所以既是运行时的输入，
// 也能单独测（「一句一框」「顺序按时间」「时长倒挂的歌词」「没有逐词时间那一档」）。
//
// 这里**不许出现 Math.random()**：运行时随时重绘、换尺寸会重搭框，随机只能在编译这一次发生，
// 否则同一个框每次重搭都换一副面孔（面板里的 token id 与采样值每次都不一样）。

/** 一个词在框里的内容与它被唱到的时间窗。 */
export interface PromptWordPlan {
    text: string;
    startTime: number;
    endTime: number;
}

/** 一句歌词 → 一个框。 */
export interface PromptBoxPlan {
    id: string;
    startTime: number;
    endTime: number;
    words: PromptWordPlan[];
    /** 决定这一句从词表里取哪几个词、印哪两个 token id。同一句每次重搭都取同一组（seek 安全）。 */
    vocabSeed: number;
}

/** FNV-1a：只用来把种子摊成一个稳定的数，不是密码学用途。 */
const hashString = (value: string): number => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const lineStart = (line: Line) => (Number.isFinite(line.startTime) ? line.startTime : 0);

/**
 * 一句的词与时间窗。
 *
 * 有逐词时间的音源直接用；整行只给一个时间窗的（不少 lrc）按语义分词，再把这一句的时长按
 * 字数摊开 —— 和磁贴墙同一个切法，所以框里的词与墙上看到的是同一套切分。
 */
const promptWordsFor = (line: Line): PromptWordPlan[] => {
    const spoken = line.words?.filter(word => word.text.trim().length > 0) ?? [];
    if (spoken.length > 0) {
        return spoken.map(word => ({
            text: word.text,
            startTime: word.startTime,
            endTime: word.endTime,
        }));
    }
    /*
     * 逐词时间戳没有的时候，靠 `segmentLyricWords` 分词。它优先用 `Intl.Segmenter`，
     * **而安卓 WebView 上它常常不存在**，掉到逐字切分 —— 中文就变成一个字一个字，
     * 底下那条逐词下划线也就退化成「逐字」（用户原话：只有中文是这样的）。
     * 所以切出来全是单字的时候，改用随包那本词表词典再切一遍。
     */
    let parts = segmentLyricWords(line);
    const cjkOnly = parts.filter(part => /^[\u4e00-\u9fff\u3040-\u30ff]$/.test(part.segment));
    if (cjkOnly.length > 0 && cjkOnly.length === parts.filter(part => part.segment.trim().length > 0).length) {
        parts = segmentWithVocab(line.fullText ?? '').map(part => ({
            segment: part.text,
            index: part.start,
            isWordLike: part.text.trim().length > 0,
        }));
    }
    const segments = parts.filter(segment => segment.segment.trim().length > 0);
    if (segments.length === 0) return [];
    const start = lineStart(line);
    // 摊的是这一句自己的时间窗；渲染提示（renderHints）里的余量留给框的收尾，不该拖慢字。
    const sung = Math.max(Number.isFinite(line.endTime) ? line.endTime : 0, start + 0.5);
    const total = segments.reduce((sum, segment) => sum + segment.segment.length, 0) || 1;
    let cursor = start;
    return segments.map(segment => {
        const span = (sung - start) * (segment.segment.length / total);
        const word = { text: segment.segment, startTime: cursor, endTime: cursor + span };
        cursor += span;
        return word;
    });
};

/**
 * 歌词 → 节目单。同一个 (lines, seed) 每次都给同一份。
 *
 * **刻意不吃主题**：主题对象在播放页每次重算都可能换一个引用，把它算进依赖里就会让「歌词没变、
 * 主题重建」也重编一遍节目单 —— 运行时会当作换歌重搭框，屏幕上就是一直在开场那一帧。
 * 框上那行提示词的「本首高亮词」由运行时搭框时现读 theme.wordColors，不进节目单。
 */
export const compilePromptBoxes = (
    lines: readonly Line[],
    seed: string | number,
): PromptBoxPlan[] => {
    const plans: PromptBoxPlan[] = [];
    lines.forEach((line, index) => {
        const words = promptWordsFor(line);
        if (words.length === 0) return;
        const start = lineStart(line);
        const end = Math.max(
            getLineRenderEndTime(line),
            words[words.length - 1].endTime,
            start + 0.6,
        );
        plans.push({
            id: line.id ?? `prompt-line-${index}-${start.toFixed(2)}`,
            startTime: start,
            endTime: end,
            words,
            vocabSeed: hashString(`${seed}:vocab:${start.toFixed(2)}`),
        });
    });
    // 歌词一般是顺序的，但「时间倒挂」的歌词集存在：框的顺序按时间走才追得对。
    plans.sort((left, right) => left.startTime - right.startTime);
    return plans;
};
