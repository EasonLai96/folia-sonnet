// src/components/visualizer/prompt/promptBox.ts
// 「提示词」那张概率面板：墨底、四角定位刻线、表头 `p( next | context ) … sampled`、
// 高亮行（▶ + 正在唱的那个 token + 采样条 + 概率）、下面一行 token id 与它的采样值，
// 面板底缘再挂一条 `› 提示词 · 提示词` 的细带。**只认几何与时间**，不认歌词引擎：
// 独立的「提示词」样式（createPromptPixiRuntime）用它搭自己的运行时。
//
// 商籁里那一种 prompt-field 镜头用的是 sonnet/sonnetPromptField.ts —— 同一套画法，但它直接吃
// 商籁自己的逐字排版（placements/segments/views），所以没有共用这一份。改画法要两边一起改。
//
// 单位是**画面 px**（运行时不再整层缩放）：字号直接就是屏上的字号，所以这里写的 13 就是 13px。
// 以前整层按「字号 100 的自然单位」再缩到屏宽，面板里 9px 的 token id 落到屏上只剩 4px，看不清。

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

/** 面板里一行要用的东西：词本身 + 它被唱到的时间窗。 */
export interface PromptPanelToken {
    text: string;
    startTime: number;
    endTime: number;
}

export interface PromptPanelSpec {
    /** 面板宽度（px）。高度按它推（≈ 0.25 倍宽）。 */
    width: number;
    /** 面板中心相对画面中心的纵向偏移（px，负数在上）。 */
    centerY: number;
    /** 主题色：高亮行、采样条、三角、光标。 */
    accent: number;
    /** 主题的「字」色：token id 与提示词细带用它。 */
    textColor: number;
    /** 这一句的种子：token id 与两个采样值都从它推，重搭不换面孔。 */
    seed: number;
    endTime: number;
    /** 面板底缘那条细带的词（AI 云缓存里随机几首的高亮标记）。 */
    terms: readonly string[];
    tokens: readonly PromptPanelToken[];
}

export interface PromptPanelView {
    root: import('pixi.js').Container;
    /** 面板总高（px）。 */
    height: number;
    /** 面板中心的纵向偏移（px）：运行时做进场位移时要在它上面加减。 */
    centerY: number;
    /** 每帧：行内容与采样条跟着「正在唱的词」走；alpha 由调用方给（进场淡入）。 */
    update: (time: number, activeWord: number, alpha: number) => void;
}

/** 两个整数摊成好用的伪随机数（token id / 采样值），只求稳定，不求随机质量。 */
const mix = (seed: number, index: number): number => {
    let hash = (Math.imul((seed | 0) ^ 0x9e3779b9, 16777619) ^ Math.imul(index + 0x85ebca6b, 2246822519)) >>> 0;
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0x5bd1e995) >>> 0;
    hash ^= hash >>> 15;
    return hash >>> 0;
};

export const buildPromptPanel = (
    pixi: PixiModule,
    spec: PromptPanelSpec,
): PromptPanelView => {
    const { Container, Graphics, Text, TextStyle } = pixi;
    const { width, terms, tokens } = spec;
    const height = Math.round(width * 0.25);
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    const ink = colorNumber(pixi, PROMPT_PALETTE.ink);
    const graphite = colorNumber(pixi, PROMPT_PALETTE.graphite);
    const ash = colorNumber(pixi, PROMPT_PALETTE.ash);
    const bone = colorNumber(pixi, PROMPT_PALETTE.bone);
    const accent = spec.accent;
    const textColor = spec.textColor;

    const root = new Container();
    root.position.set(0, spec.centerY);

    const padX = Math.round(width * 0.035);
    const headerH = Math.round(height * 0.27);
    const row1H = Math.round(height * 0.43);
    const row2H = height - headerH - row1H;
    const innerLeft = -halfWidth + padX;
    const innerRight = halfWidth - padX;
    const headerY = -halfHeight + headerH * 0.58;
    const row1Y = -halfHeight + headerH + row1H / 2;
    const row2Y = -halfHeight + headerH + row1H + row2H / 2;

    /*
     * ---- 底板：一张圆角浮窗，墨底 + 一圈很淡的细线。
     * 精简样式：四角定位刻线、键帽、方括号那些「终端感」的装饰全部不要，只留表头 + 两行数。
     */
    const plate = new Graphics();
    const radius = Math.max(10, Math.round(height * 0.1));
    plate.roundRect(-halfWidth, -halfHeight, width, height, radius).fill({ color: ink, alpha: 0.9 });
    plate.roundRect(-halfWidth, -halfHeight, width, height, radius).stroke({ color: bone, width: 1, alpha: 0.26 });
    // 高亮行：整条贯穿到左右边缘，像表格里被选中的那一行。
    plate.rect(-halfWidth, row1Y - row1H / 2, width, row1H).fill({ color: accent, alpha: 0.14 });
    plate.rect(-halfWidth, row1Y - row1H / 2, width, 1).fill({ color: accent, alpha: 0.5 });
    plate.rect(-halfWidth, row1Y + row1H / 2 - 1, width, 1).fill({ color: accent, alpha: 0.3 });
    root.addChild(plate);

    const headerFont = Math.max(10, Math.round(headerH * 0.4));
    const tokenFont = Math.max(14, Math.round(row1H * 0.46));
    const idFont = Math.max(11, Math.round(row2H * 0.4));

    // ---- 表头：左 p( next | context )，右 sampled
    const headerStyle = new TextStyle({
        fontFamily: PROMPT_MONO_STACK,
        fontSize: headerFont,
        fill: PROMPT_PALETTE.ash,
        letterSpacing: 0.6,
    });
    const headerLeft = new Text({ text: 'p( next | context )', style: headerStyle });
    headerLeft.anchor.set(0, 0.5);
    headerLeft.position.set(innerLeft, headerY);
    const headerRight = new Text({ text: 'sampled', style: headerStyle });
    headerRight.anchor.set(1, 0.5);
    headerRight.position.set(innerRight, headerY);
    root.addChild(headerLeft, headerRight);

    // ---- 高亮行：▶ + token + 采样条 + 概率
    const tri = new Graphics()
        .poly([0, 0, 0, row1H * 0.2, row1H * 0.17, row1H * 0.1])
        .fill({ color: accent, alpha: 1 });
    tri.position.set(innerLeft, row1Y);
    root.addChild(tri);

    const tokenText = new Text({
        text: '',
        style: new TextStyle({
            fontFamily: PROMPT_MONO_STACK,
            fontWeight: '600',
            fontSize: tokenFont,
            fill: '#ffffff',
        }),
    });
    tokenText.anchor.set(0, 0.5);
    tokenText.position.set(innerLeft + row1H * 0.26, row1Y);
    root.addChild(tokenText);

    const probText = new Text({
        text: '',
        style: new TextStyle({
            fontFamily: PROMPT_MONO_STACK,
            fontWeight: '600',
            fontSize: tokenFont * 0.92,
            fill: '#ffffff',
        }),
    });
    probText.anchor.set(1, 0.5);
    probText.position.set(innerRight, row1Y);
    root.addChild(probText);

    // 采样条：一条暗底 + 一条按进度长的亮条（左端跟着 token 的字宽走，右端顶到概率前面）
    const barTrack = new Graphics()
        .rect(0, -row1H * 0.055, 1, row1H * 0.11)
        .fill({ color: graphite, alpha: 0.5 });
    const barFill = new Graphics()
        .rect(0, -row1H * 0.08, 1, row1H * 0.16)
        .fill({ color: accent, alpha: 1 });
    barTrack.pivot.set(0, 0);
    barFill.pivot.set(0, 0);
    root.addChild(barTrack, barFill);

    // ---- 第二行：token id …… 采样值
    const idText = new Text({
        text: '',
        style: new TextStyle({ fontFamily: PROMPT_MONO_STACK, fontSize: idFont, fill: '#ffffff' }),
    });
    idText.anchor.set(0, 0.5);
    idText.position.set(innerLeft, row2Y);
    root.addChild(idText);

    const pipe = new Graphics()
        .rect(0, -row2H * 0.24, Math.max(1, Math.round(row2H * 0.03)), row2H * 0.48)
        .fill({ color: graphite, alpha: 0.9 });
    pipe.position.set(innerLeft + width * 0.2, row2Y);
    root.addChild(pipe);

    const prob2Text = new Text({
        text: '',
        style: new TextStyle({ fontFamily: PROMPT_MONO_STACK, fontSize: idFont * 0.92, fill: '#ffffff' }),
    });
    prob2Text.anchor.set(1, 0.5);
    prob2Text.position.set(innerRight, row2Y);
    root.addChild(prob2Text);

    // ---- 面板底缘那条细带：`› 词 · 词 · 词`（AI 云缓存里随机几首的高亮标记）
    const stripFont = Math.max(9, Math.round(idFont * 0.82));
    const strip = new Text({
        text: '',
        style: new TextStyle({
            fontFamily: PROMPT_MONO_STACK,
            fontSize: stripFont,
            fill: '#ffffff',
            letterSpacing: 0.8,
        }),
    });
    strip.anchor.set(0, 0);
    strip.position.set(innerLeft, halfHeight + Math.max(6, stripFont * 0.7));
    strip.alpha = 0.62;
    // 面板是墨底、背景不一定暗：细带本身要能读，所以按主题字色给。
    strip.tint = textColor;
    root.addChild(strip);

    const metricsApi = (pixi as unknown as {
        CanvasTextMetrics?: { measureText: (text: string, style: unknown) => { width: number } };
    }).CanvasTextMetrics;
    const measure = (text: string, style: TextStyle, fallback: number): number => {
        try {
            const value = metricsApi?.measureText(text, style).width;
            return Number.isFinite(value) && (value as number) > 0 ? (value as number) : text.length * fallback;
        } catch {
            return text.length * fallback;
        }
    };
    const stripLimit = width * 0.94;
    let stripText = '›';
    terms.forEach(term => {
        const next = stripText === '›' ? `› ${term}` : `${stripText}  ·  ${term}`;
        if (measure(next, strip.style, stripFont * 0.62) > stripLimit) return;
        stripText = next;
    });
    strip.text = stripText;

    // 每个词自己的 id 与两个采样值：按种子算好，同一个词永远同一组数。
    const stats = tokens.map((token, index) => {
        const idHash = mix(spec.seed, index);
        const valueHash = mix(spec.seed ^ 0x5f356495, index);
        return {
            id: `T-${100 + (idHash % 8900)}`,
            sampled: 0.9 + (valueHash % 100) / 1000,
            raw: 0.001 + (idHash % 90) / 1000,
        };
    });

    let shownWord = -2;
    /** 采样条这一帧要走多长（跟着 token 字宽变，所以每次换词重算一次）。 */
    let barSpan = 0;
    const update = (time: number, activeWord: number, alpha: number) => {
        const index = activeWord >= 0 && activeWord < tokens.length ? activeWord : -1;
        const token = index >= 0 ? tokens[index] : null;
        const stat = index >= 0 ? stats[index] : null;

        if (index !== shownWord) {
            shownWord = index;
            tokenText.text = token?.text ?? '';
            probText.text = stat ? stat.sampled.toFixed(2) : '–.––';
            idText.text = stat?.id ?? 'T-000';
            idText.tint = textColor;
            prob2Text.text = stat ? stat.raw.toFixed(3) : '0.000';
            prob2Text.tint = ash;
            /*
             * 采样条起点跟着 token 字宽走：不同长度的词，条子都紧跟在字后面。
             * 宽度用 CanvasTextMetrics 现量，不读 `node.width` —— v8 里 Text 的纹理会
             * 延到渲染管道里才更新，刚换完 text 读 width 可能还是上一个词的。
             */
            const wordWidth = measure(token?.text ?? '', tokenText.style, tokenFont * 0.6);
            const probWidth = measure(stat ? stat.sampled.toFixed(2) : '', probText.style, tokenFont * 0.6);
            const barLeft = innerLeft + row1H * 0.26 + wordWidth + row1H * 0.24;
            const barRight = innerRight - probWidth - row1H * 0.28;
            barSpan = Math.max(8, barRight - barLeft);
            barTrack.position.set(barLeft, row1Y);
            barTrack.scale.x = barSpan;
            barFill.position.set(barLeft, row1Y);
            barFill.visible = barRight > barLeft;
        }

        // 采样条按「这个词唱到几成」长：唱过就留满。
        const progress = token ? progressOf(time, token.startTime, token.endTime) : 0;
        barFill.scale.x = Math.max(0.001, barSpan * progress);

        // 唱到就亮、唱过就暗下去；闪烁交给采样条与三角。
        const sung = token ? clamp01((time - token.startTime) / 0.16) : 0;
        tri.alpha = (0.55 + 0.45 * (1 - sung)) * alpha;
        tokenText.alpha = alpha;
        probText.alpha = alpha;
        idText.alpha = alpha * 0.92;
        prob2Text.alpha = alpha * 0.85;
        pipe.alpha = alpha * 0.8;
        barTrack.alpha = alpha * 0.9;
        barFill.alpha = alpha;
        headerLeft.alpha = alpha * 0.8;
        headerRight.alpha = alpha * 0.8;
        strip.alpha = alpha * 0.62;
        // 三角与概率随词变动闪一下，像面板在重新采样。
        tri.scale.set(1 + 0.18 * (1 - sung), 1 + 0.18 * (1 - sung));
    };

    return { root, height, centerY: spec.centerY, update };
};
