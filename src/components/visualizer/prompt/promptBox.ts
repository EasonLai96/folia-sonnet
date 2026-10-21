// src/components/visualizer/prompt/promptBox.ts
// 「提示词输入框」那一套 UI —— 最早那版的样子，但**做成一块小悬浮窗**：
// 只要两样东西 —— **整个发送框**，和**词底下那条下划线分词**。别的（四角刻线、› 提示符、
// 投影、一堆数字）全不要：窗本来就只有一行字高，多画一笔就是糊。
//
//   ╭───────────────────────────╮
//   │  我们 都曾 年少           │   ← 字本身
//   │  ▁▁▁▁ ▁▁▁▁ ▁▁▁▁           │   ← 每词一条下划线（唱到哪填到哪 = 分词 + 卡拉 OK）
//   ╰───────────────────────────╯
//
// 下划线是「分词」唯一看得见的地方：一句切成几个 token、唱到第几个，全在这条线上。
// 正在唱的那个词下面会浮出它在词表里的 id（一次只一个，不糊）。
//
// **只认几何与时间**，不认歌词引擎：独立的「提示词」样式（createPromptPixiRuntime）拿它搭场。
// 单位是画面 px（不整层缩放），这里写 13 就是屏上的 13px。
//
// 商籁里那一种 prompt-field 镜头用的是 sonnet/sonnetPromptField.ts（吃商籁自己的逐字排版），
// 同一套画法但没共用这一份，改画法要两边一起看。

import { promptVocabIdFor } from './promptTokenId';

type PixiModule = typeof import('pixi.js');

/** pdoom-video 的调色板：墨底、骨白细线、信号橙。主题色由调用方覆盖。 */
export const PROMPT_PALETTE = {
    ink: '#0A0A0B',
    ink2: '#151517',
    graphite: '#5E5B57',
    ash: '#9C978F',
    bone: '#EEE9DF',
    signal: '#FF4D12',
} as const;

/** token id 这类「不是歌词」的小字用等宽，歌词本身用主题字体。 */
export const PROMPT_MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

const colorNumber = (pixi: PixiModule, color: string) => pixi.Color.shared.setValue(color).toNumber();
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const progressOf = (time: number, start: number, end: number) => (
    end <= start ? (time >= end ? 1 : 0) : clamp01((time - start) / (end - start))
);

/** 一句装不下时最多缩到原字号的这个比例，再小就不缩了（剩下的交给镜头跟）。 */
const MIN_SHRINK = 0.54;
/** 词与词之间的空隙占字号的比例。 */
const WORD_GAP = 0.3;

export interface PromptCardToken {
    text: string;
    startTime: number;
    endTime: number;
}

export interface PromptCardSpec {
    /** 窗最多能有多宽（屏宽的一部分）。整句装不下就缩字，缩到底才靠镜头跟。 */
    maxWidth: number;
    /** 基础字号：已经乘过「歌词字号」那个全局系数。 */
    fontPx: number;
    /** 主题色：下划线填色、光标。 */
    accent: number;
    /** 主题的「字」色：没唱到的字、框线、下划线底。 */
    textColor: number;
    /** 歌词字体（主题字体栈）。 */
    fontFamily: string;
    fontWeight: string | number;
    tokens: readonly PromptCardToken[];
}

export interface PromptLaidToken {
    left: number;
    width: number;
}

export interface PromptCardView {
    root: import('pixi.js').Container;
    /** 歌词层：运行时把逐词 Text 加进来，坐标 0 就是「第一个词的左边」。 */
    textLayer: import('pixi.js').Container;
    /** 每个词量出来的位置与宽度（与 spec.tokens 同序）。 */
    laid: readonly PromptLaidToken[];
    /** 这一套的最终字号（缩过之后的）。 */
    fontPx: number;
    /** 窗宽 / 内容宽（px），镜头算可移动范围用。 */
    windowWidth: number;
    contentWidth: number;
    /** 字的竖中线（相对窗中心）。 */
    textY: number;
    /** 每帧：下划线、卡拉 OK、当前词的 id。 */
    update: (time: number, activeIndex: number) => void;
}

export const buildPromptCard = (
    pixi: PixiModule,
    spec: PromptCardSpec,
): PromptCardView => {
    const { Container, Graphics, Text, TextStyle } = pixi;
    const { tokens, accent, textColor } = spec;
    const ink = colorNumber(pixi, PROMPT_PALETTE.ink);

    // ---- 量宽：先用基础字号量一遍，装不下按比例缩（缩到底就停），窗宽再按最终宽度收放
    const metricsApi = (pixi as unknown as {
        CanvasTextMetrics?: { measureText: (text: string, style: unknown) => { width: number } };
    }).CanvasTextMetrics;
    const measureStyle = new TextStyle({
        fontFamily: spec.fontFamily,
        fontWeight: spec.fontWeight as never,
        fontSize: spec.fontPx,
    });
    /*
     * 量宽必须拿**真的 TextStyle 实例**：CanvasTextMetrics.measureText 从 style 上读
     * `letterSpacing` / `_fontString` / `styleKey`，给普通对象就是 undefined → NaN → 整行消失。
     */
    const measure = (text: string, size: number): number => {
        try {
            const width = metricsApi ? metricsApi.measureText(text, measureStyle).width : Number.NaN;
            // 量不到就按字数估：宁可字宽估歪，不能让整行字和窗一起不见。
            return Number.isFinite(width) && width > 0 ? width : text.length * size * 0.62;
        } catch {
            return text.length * size * 0.62;
        }
    };

    const padX = Math.round(spec.fontPx * 0.7);
    const available = Math.max(120, spec.maxWidth - padX * 2);
    const gaps = Math.max(0, tokens.length - 1) * spec.fontPx * WORD_GAP;

    let natural = gaps;
    tokens.forEach(token => { natural += measure(token.text, spec.fontPx); });
    const shrink = natural > available ? clamp(available / natural, MIN_SHRINK, 1) : 1;
    // 字号只往下缩，**绝不因为字少而放大** —— 两个字撑成一屏大的就是「字少时太难看」。
    const fontPx = spec.fontPx * shrink;
    const gap = fontPx * WORD_GAP;

    const laid: PromptLaidToken[] = [];
    let cursor = 0;
    tokens.forEach(token => {
        const width = measure(token.text, spec.fontPx) * shrink;
        laid.push({ left: cursor, width });
        cursor += width + gap;
    });
    const contentWidth = Math.max(1, cursor - (tokens.length > 0 ? gap : 0));
    const windowWidth = Math.min(spec.maxWidth, contentWidth + padX * 2);

    // ---- 窗：只要一个框。半透明墨底 + 一圈细线，圆角收小一点，像贴上去的一行输入框。
    const underlineY = fontPx * 0.62;
    const windowHeight = fontPx * 1.72;
    const radius = Math.max(8, fontPx * 0.26);
    const left = -windowWidth / 2;
    const top = -windowHeight / 2;
    const textY = -fontPx * 0.24;
    const contentLeft = left + padX;

    const root = new Container();
    const plate = new Graphics()
        .roundRect(left, top, windowWidth, windowHeight, radius)
        .fill({ color: ink, alpha: 0.46 })
        .roundRect(left, top, windowWidth, windowHeight, radius)
        .stroke({ color: textColor, width: 1, alpha: 0.24 });
    root.addChild(plate);

    const textLayer = new Container();
    textLayer.position.set(contentLeft, textY);
    root.addChild(textLayer);

    // ---- 逐词下划线（底 + 唱到的填充色）与「当前词」的 id
    const hair = Math.max(1.5, fontPx * 0.045);
    const idFont = Math.max(8, Math.round(fontPx * 0.2));
    const idStyle = new TextStyle({ fontFamily: PROMPT_MONO_STACK, fontSize: idFont, fill: '#ffffff' });

    const trackNodes: import('pixi.js').Graphics[] = [];
    const fillNodes: import('pixi.js').Graphics[] = [];
    const idNodes: import('pixi.js').Text[] = [];

    laid.forEach((token, index) => {
        const track = new Graphics()
            .rect(0, 0, token.width, hair)
            .fill({ color: textColor, alpha: 0.3 });
        track.position.set(token.left, underlineY);
        const fill = new Graphics()
            .rect(0, 0, 1, hair)
            .fill({ color: accent, alpha: 1 });
        fill.position.set(token.left, underlineY);
        fill.scale.x = 0.001;
        // 正在唱的那个词下面浮出它在词表里的号：一次只有一个，不糊。
        const idText = new Text({ text: String(promptVocabIdFor(tokens[index].text)), style: idStyle });
        idText.anchor.set(0.5, 0);
        idText.position.set(token.left + token.width / 2, underlineY + hair * 1.8);
        idText.tint = textColor;
        idText.alpha = 0;
        root.addChild(track, fill, idText);
        trackNodes.push(track);
        fillNodes.push(fill);
        idNodes.push(idText);
    });

    const update = (time: number, activeIndex: number) => {
        laid.forEach((token, index) => {
            const source = tokens[index];
            const typed = progressOf(time, source.startTime, source.endTime);
            const age = time - source.startTime;
            const flash = age >= 0 && age < 0.2 ? 1 - age / 0.2 : 0;
            const settled = 1 - 0.4 * progressOf(time, source.endTime, source.endTime + 1.8);

            // 下划线：唱过的留亮，刚落下的那个词闪一下。
            trackNodes[index].alpha = (0.7 + 0.3 * flash) * settled;
            fillNodes[index].scale.x = Math.max(0.001, token.width * typed);
            fillNodes[index].alpha = (0.85 + 0.15 * flash) * settled;
            // 当前词的 id：只给正在唱的那个显示（静态模式下也要能看见，所以直接给值、不做渐变）。
            idNodes[index].alpha = index === activeIndex ? 0.62 : 0;
        });
    };

    return {
        root,
        textLayer,
        laid,
        fontPx,
        windowWidth,
        contentWidth,
        textY,
        update,
    };
};
