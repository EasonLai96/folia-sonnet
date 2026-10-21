// src/components/visualizer/prompt/promptBox.ts
// 「提示词」那一整套 UI，按 pdoom prompt2 的版式摆：
//
//   ┌ 候选面板（比下面那张窄，右边对齐）───────┐
//   │ p( next | context )          sampled │
//   │ ▶ 当前词  ██████████           0.74  │
//   │   陪衬词  ▪                    0.09  │
//   │   陪衬词  ▪                    0.06  │
//   │   陪衬词  ▪                    0.02  │
//   └──────────────────────────────────────┘
//   ┌ 歌词窗（宽，桌面歌词那种悬浮条）──────────────────┐
//   │ ›  ChatGl                    （唱到的字发光）     │
//   │    ▂▂▂▂                   63963        63739    │
//   └──────────────────────────────────────────────────┘
//     PROMPT 01
//     top-p 0.95 · seed 0x2A
//     P( doom ) 0.04 · context-dependent
//
// **只认几何与时间**，不认歌词引擎：独立的「提示词」样式（createPromptPixiRuntime）拿它搭场。
// 单位是画面 px（不整层缩放），这里写 13 就是屏上的 13px。
//
// 面板上的词与窗底那两个五位数字都来自真实的 30000 词中文词表（见 promptVocab.ts）：
// 数字是词表 id，词是同一个 id 的那个词，所以二者对得上，不像随机数那样一眼假。
//
// 商籁里那一种 prompt-field 镜头用的是 sonnet/sonnetPromptField.ts（吃商籁自己的逐字排版），
// 同一套画法但没共用这一份，改画法要两边一起看。

import { promptVocabLabel, promptVocabPick } from './promptVocab';

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

export const PROMPT_MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

const colorNumber = (pixi: PixiModule, color: string) => pixi.Color.shared.setValue(color).toNumber();
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const progressOf = (time: number, start: number, end: number) => (
    end <= start ? (time >= end ? 1 : 0) : clamp01((time - start) / (end - start))
);

/** 两个整数摊成好用的伪随机数（token id / 采样值），只求稳定，不求随机质量。 */
const mix = (a: number, b: number): number => {
    let hash = (Math.imul((a | 0) ^ 0x9e3779b9, 16777619) ^ Math.imul(b + 0x85ebca6b, 2246822519)) >>> 0;
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0x5bd1e995) >>> 0;
    hash ^= hash >>> 15;
    return hash >>> 0;
};

export interface PromptCardToken {
    text: string;
    startTime: number;
    endTime: number;
}

export interface PromptCardSpec {
    /** 歌词窗宽度（px）。候选面板、字号、窗高全按它推。 */
    width: number;
    /** 主题色：唱到的字、高亮行、采样条、窗里那条进度。 */
    accent: number;
    /** 主题的「字」色：灰字、细线、唱过但没被 AI 标色的词。 */
    textColor: number;
    /** 这一句的种子：token id、采样值、细线上的 seed 都从它推。 */
    seed: number;
    /** 这句是第几句（1 起），给下面 `PROMPT 01` 用。 */
    lineIndex: number;
    tokens: readonly PromptCardToken[];
    /** 候选面板里陪衬的三个词（AI 云缓存里随机几首的高亮标记）。 */
    candidates: readonly string[];
}

export interface PromptCardView {
    root: import('pixi.js').Container;
    /** 歌词层（已挂遮罩）：运行时把逐词 Text 加进来，坐标 0 就是「字的起点」。 */
    textLayer: import('pixi.js').Container;
    /** 字的起点（相对卡片中心）与字的竖中线。 */
    textOriginX: number;
    textOriginY: number;
    /** 字能用的宽度：超出这个宽度才需要横向跟随。 */
    textWidth: number;
    /** 这一套的字号：只跟窗高走，**不按内容反解**。 */
    fontPx: number;
    /** 整组（面板 + 窗 + 信息块）的竖向半高。 */
    halfHeight: number;
    /** 每帧：候选面板、窗里的进度。 */
    update: (time: number, activeWord: number, lineProgress: number) => void;
}

export const buildPromptCard = (
    pixi: PixiModule,
    spec: PromptCardSpec,
): PromptCardView => {
    const { Container, Graphics, Text, TextStyle } = pixi;
    const { width, tokens, candidates } = spec;
    const height = Math.round(width * 0.21);
    const halfW = width / 2;
    const halfH = height / 2;

    const ink = colorNumber(pixi, PROMPT_PALETTE.ink);
    const graphite = colorNumber(pixi, PROMPT_PALETTE.graphite);
    const accent = spec.accent;
    const textColor = spec.textColor;

    // ---- 字号与横向排布：全部由窗宽/窗高推，长句就横向跟随，不把字压小
    const fontPx = Math.max(18, Math.round(height * 0.4));
    const padX = Math.round(height * 0.16);
    const chevronSize = height * 0.2;
    const chevronX = -halfW + padX;
    const textOriginX = chevronX + chevronSize * 1.5 + padX * 0.6;
    const textWidth = width - (textOriginX + halfW) - padX;

    // ---- 纵向：先把面板、窗、信息块三段的高度算清，再整体居中
    const panelW = width * 0.6;
    const panelH = height * 0.86;
    const gap = height * 0.16;
    const headerH = panelH * 0.2;
    const rowH = (panelH - headerH) / 4;
    const infoFont = Math.max(10, Math.round(height * 0.115));
    const infoLineH = height * 0.17;

    const panelTop0 = -halfH - gap - panelH;
    const infoTop0 = halfH + height * 0.1;
    const groupTop = panelTop0;
    const groupBottom = infoTop0 + infoLineH * 2 + infoFont * 1.2;
    const halfHeight = (groupBottom - groupTop) / 2;
    /** 把「窗中心」搬到「整组中心」的位移：之后所有 y 都加它。 */
    const y0 = -halfHeight - groupTop;

    const textOriginY = -height * 0.03 + y0;
    const panelLeft = halfW - panelW;
    const panelTop = panelTop0 + y0;
    const infoTop = infoTop0 + y0;
    const rowY = (index: number) => panelTop + headerH + rowH * (index + 0.5);

    const root = new Container();

    /*
     * ---- 歌词窗：桌面歌词那种悬浮条 —— 半透明墨底、一圈细线、圆角。
     * 底要透，唱到的字要盖在它上面，不能是一整块黑板。
     */
    const plate = new Graphics();
    const radius = Math.max(8, Math.round(height * 0.08));
    plate.roundRect(-halfW, -halfH + y0, width, height, radius).fill({ color: ink, alpha: 0.55 });
    plate.roundRect(-halfW, -halfH + y0, width, height, radius).stroke({ color: textColor, width: 1, alpha: 0.22 });
    root.addChild(plate);

    // 提示符 ›：两条线，比字体里那个符号稳
    const chevron = new Graphics()
        .moveTo(chevronX, textOriginY - chevronSize * 0.42)
        .lineTo(chevronX + chevronSize * 0.48, textOriginY)
        .lineTo(chevronX, textOriginY + chevronSize * 0.42)
        .stroke({ color: textColor, width: Math.max(1.4, height * 0.012), alpha: 0.7 });
    root.addChild(chevron);

    // 字的遮罩：长句横向跟随的时候，字只出现在窗里
    const mask = new Graphics()
        .rect(textOriginX, -halfH + y0 + height * 0.1, textWidth, height * 0.8)
        .fill({ color: 0xffffff, alpha: 1 });
    root.addChild(mask);
    const textLayer = new Container();
    textLayer.position.set(textOriginX, textOriginY);
    textLayer.mask = mask;
    root.addChild(textLayer);

    // 窗里那条进度：整句唱到几成
    const barY = halfH + y0 - height * 0.17;
    const barHeight = Math.max(2, height * 0.022);
    const barWidth = textWidth * 0.34;
    const barTrack = new Graphics()
        .rect(0, 0, 1, barHeight)
        .fill({ color: textColor, alpha: 0.22 });
    const barFill = new Graphics()
        .rect(0, 0, 1, barHeight)
        .fill({ color: accent, alpha: 0.95 });
    barTrack.position.set(textOriginX, barY);
    barTrack.scale.x = barWidth;
    barFill.position.set(textOriginX, barY);
    root.addChild(barTrack, barFill);

    // 窗底那两个五位数字：真实词表 id（不足五位补 0），位置和 pdoom 里那对一样偏左。
    const idFont = Math.max(9, Math.round(height * 0.085));
    const idStyle = new TextStyle({ fontFamily: PROMPT_MONO_STACK, fontSize: idFont, fill: '#ffffff' });
    const idLeft = new Text({ text: promptVocabLabel(spec.seed, 0), style: idStyle });
    idLeft.anchor.set(0, 1);
    idLeft.position.set(textOriginX, halfH + y0 - height * 0.02);
    idLeft.tint = textColor;
    idLeft.alpha = 0.5;
    const idRight = new Text({ text: promptVocabLabel(spec.seed, 1), style: idStyle });
    idRight.anchor.set(0, 1);
    idRight.position.set(textOriginX + textWidth * 0.38, halfH + y0 - height * 0.02);
    idRight.tint = textColor;
    idRight.alpha = 0.5;
    root.addChild(idLeft, idRight);

    /*
     * ---- 候选面板：**比窗窄**（0.6 倍宽）、右边对齐，表头 + 一行高亮 + 三行陪衬。
     * 参考画面里这一块就是 p( next | context ) / sampled 那张小表。
     */
    const panel = new Graphics();
    panel.roundRect(panelLeft, panelTop, panelW, panelH, radius * 0.7).fill({ color: ink, alpha: 0.78 });
    // 高亮行：整条贯穿到面板左右边缘
    panel.rect(panelLeft, panelTop + headerH, panelW, rowH).fill({ color: accent, alpha: 0.16 });
    panel.rect(panelLeft, panelTop + headerH, panelW, 1).fill({ color: accent, alpha: 0.5 });
    panel.rect(panelLeft, panelTop + headerH + rowH - 1, panelW, 1).fill({ color: accent, alpha: 0.3 });
    root.addChild(panel);

    const panelPad = panelW * 0.045;
    const headerFont = Math.max(9, Math.round(headerH * 0.42));
    const rowFont = Math.max(11, Math.round(rowH * 0.46));
    const headerStyle = new TextStyle({
        fontFamily: PROMPT_MONO_STACK,
        fontSize: headerFont,
        fill: '#ffffff',
        letterSpacing: 0.5,
    });
    const headerY = panelTop + headerH * 0.54;
    const headerLeft = new Text({ text: 'p( next | context )', style: headerStyle });
    headerLeft.anchor.set(0, 0.5);
    headerLeft.position.set(panelLeft + panelPad, headerY);
    headerLeft.tint = textColor;
    headerLeft.alpha = 0.5;
    const headerRight = new Text({ text: 'sampled', style: headerStyle });
    headerRight.anchor.set(1, 0.5);
    headerRight.position.set(panelLeft + panelW - panelPad, headerY);
    headerRight.tint = textColor;
    headerRight.alpha = 0.5;
    root.addChild(headerLeft, headerRight);

    const rowStyle = (size: number, weight: '400' | '600') => new TextStyle({
        fontFamily: PROMPT_MONO_STACK,
        fontWeight: weight,
        fontSize: size,
        fill: '#ffffff',
    });

    // 第一行：▶ + 正在唱的那个词 + 采样条 + 概率
    const tri = new Graphics()
        .poly([0, 0, 0, rowH * 0.22, rowH * 0.19, rowH * 0.11])
        .fill({ color: accent, alpha: 1 });
    tri.position.set(panelLeft + panelPad, rowY(0));
    root.addChild(tri);

    const currentText = new Text({ text: '', style: rowStyle(rowFont, '600') });
    currentText.anchor.set(0, 0.5);
    currentText.position.set(panelLeft + panelPad + rowH * 0.3, rowY(0));
    currentText.tint = accent;
    const currentProb = new Text({ text: '', style: rowStyle(rowFont * 0.94, '600') });
    currentProb.anchor.set(1, 0.5);
    currentProb.position.set(panelLeft + panelW - panelPad, rowY(0));
    currentProb.tint = accent;
    root.addChild(currentText, currentProb);

    const sampleTrack = new Graphics()
        .rect(0, -rowH * 0.05, 1, rowH * 0.1)
        .fill({ color: graphite, alpha: 0.55 });
    const sampleFill = new Graphics()
        .rect(0, -rowH * 0.07, 1, rowH * 0.14)
        .fill({ color: accent, alpha: 1 });
    sampleTrack.position.set(0, rowY(0));
    sampleFill.position.set(0, rowY(0));
    root.addChild(sampleTrack, sampleFill);

    // 三行陪衬：词 + 一个小刻度 + 概率
    const altNames: import('pixi.js').Text[] = [];
    const altProbs: import('pixi.js').Text[] = [];
    for (let index = 0; index < 3; index += 1) {
        const name = new Text({ text: '', style: rowStyle(rowFont * 0.92, '400') });
        name.anchor.set(0, 0.5);
        name.position.set(panelLeft + panelPad, rowY(index + 1));
        name.tint = textColor;
        name.alpha = 0.62;
        const prob = new Text({ text: '', style: rowStyle(rowFont * 0.86, '400') });
        prob.anchor.set(1, 0.5);
        prob.position.set(panelLeft + panelW - panelPad, rowY(index + 1));
        prob.tint = textColor;
        prob.alpha = 0.55;
        const tick = new Graphics()
            .rect(0, -rowH * 0.09, Math.max(2, rowH * 0.12), rowH * 0.18)
            .fill({ color: textColor, alpha: 0.3 });
        tick.position.set(panelLeft + panelW * 0.62, rowY(index + 1));
        root.addChild(name, prob, tick);
        altNames.push(name);
        altProbs.push(prob);
    }

    /*
     * ---- 窗下面那三行小字：`PROMPT 01` / `top-p … seed …` / `P( doom ) …`
     * 参考画面里就是这三行，左对齐到窗的左边缘。
     */
    const infoStyle = new TextStyle({
        fontFamily: PROMPT_MONO_STACK,
        fontSize: infoFont,
        fill: '#ffffff',
        letterSpacing: 0.4,
    });
    const infoLabel = new Text({ text: 'PROMPT', style: infoStyle });
    infoLabel.anchor.set(0, 0);
    infoLabel.position.set(-halfW + padX, infoTop);
    infoLabel.tint = textColor;
    infoLabel.alpha = 0.6;
    const infoIndex = new Text({ text: String(spec.lineIndex).padStart(2, '0'), style: infoStyle });
    infoIndex.anchor.set(0, 0);
    infoIndex.position.set(-halfW + padX + infoFont * 4.2, infoTop);
    infoIndex.tint = accent;
    const seedHex = (spec.seed % 0x10000).toString(16).toUpperCase().padStart(4, '0');
    const infoLine2 = new Text({ text: `top-p 0.95 · seed 0x${seedHex}`, style: infoStyle });
    infoLine2.anchor.set(0, 0);
    infoLine2.position.set(-halfW + padX, infoTop + infoLineH);
    infoLine2.tint = textColor;
    infoLine2.alpha = 0.5;
    const topProb = 0.9 + (mix(spec.seed, 7) % 90) / 1000;
    // `P( 词 )` 用面板里第一个候选词 —— 参考画面那一行就是拿候选词算的。
    const probeWord = candidates[0] ?? promptVocabPick(spec.seed, 2).text;
    const infoLine3 = new Text({
        text: `P( ${probeWord} ) ${(0.01 + (mix(spec.seed, 13) % 90) / 1000).toFixed(2)} · context-dependent`,
        style: infoStyle,
    });
    infoLine3.anchor.set(0, 0);
    infoLine3.position.set(-halfW + padX, infoTop + infoLineH * 2);
    infoLine3.tint = textColor;
    infoLine3.alpha = 0.5;
    root.addChild(infoLabel, infoIndex, infoLine2, infoLine3);

    // 每个词自己的概率：按种子算好，同一个词永远同一组数。
    const stats = tokens.map((_, index) => (
        index === 0 ? topProb : 0.9 + (mix(spec.seed ^ 0x51ed27, index) % 100) / 1000
    ));

    // 陪衬词的采样值：0.09 / 0.05 / 0.03 那一档，一定是递减的。
    candidates.slice(0, 3).forEach((word, index) => {
        altNames[index].text = word;
        const value = 0.09 / (index + 1) + (mix(spec.seed, 31 + index) % 9) / 1000;
        altProbs[index].text = value.toFixed(2);
    });

    const metricsApi = (pixi as unknown as {
        CanvasTextMetrics?: { measureText: (text: string, style: unknown) => { width: number } };
    }).CanvasTextMetrics;
    const measure = (text: string, style: import('pixi.js').TextStyle, fallback: number): number => {
        try {
            const value = metricsApi ? metricsApi.measureText(text, style).width : Number.NaN;
            return Number.isFinite(value) && value > 0 ? value : text.length * fallback;
        } catch {
            return text.length * fallback;
        }
    };

    /*
     * 句首「还没唱到第一个词」和句尾（`activeWord` 掉回 -1）这两段，高亮行不该空着 ——
     * 空一行带三角的面板看起来像坏了。填一个词表里的词，当作「下一个 token 的采样」。
     */
    const idleWord = promptVocabPick(spec.seed, 5).text;
    const idleProb = (0.2 + (mix(spec.seed, 61) % 40) / 100).toFixed(2);

    let shownWord = -2;
    let sampleSpan = 0;
    const update = (time: number, activeWord: number, lineProgress: number) => {
        const index = activeWord >= 0 && activeWord < tokens.length ? activeWord : -1;
        const token = index >= 0 ? tokens[index] : null;
        const wordText = token?.text ?? idleWord;
        const topText = index >= 0 ? stats[index].toFixed(2) : idleProb;

        if (index !== shownWord) {
            shownWord = index;
            currentText.text = wordText;
            currentProb.text = topText;
            // 采样条起点跟着词宽走：短词条子长、长词条子短，右边始终留出概率的位置。
            const nameWidth = measure(wordText, currentText.style, rowFont * 0.6);
            const probWidth = measure(topText, currentProb.style, rowFont * 0.6);
            const barLeft = panelLeft + panelPad + rowH * 0.3 + nameWidth + rowH * 0.3;
            const barRight = panelLeft + panelW - panelPad - probWidth - rowH * 0.3;
            sampleSpan = Math.max(6, barRight - barLeft);
            sampleTrack.position.set(barLeft, rowY(0));
            sampleTrack.scale.x = sampleSpan;
            sampleFill.position.set(barLeft, rowY(0));
            sampleTrack.visible = barRight > barLeft;
            sampleFill.visible = barRight > barLeft;
        }

        const progress = token ? progressOf(time, token.startTime, token.endTime) : 0;
        sampleFill.scale.x = Math.max(0.001, sampleSpan * progress);
        // 三角随词一变闪一下，像面板正在重新采样。
        const fresh = token ? clamp01((time - token.startTime) / 0.16) : 0;
        tri.scale.set(1 + 0.2 * (1 - fresh), 1 + 0.2 * (1 - fresh));
        // 窗里那条进度：整句唱到几成。
        barFill.scale.x = Math.max(0.001, barWidth * clamp01(lineProgress));
    };

    return {
        root,
        textLayer,
        textOriginX,
        textOriginY,
        textWidth,
        fontPx,
        halfHeight,
        update,
    };
};
