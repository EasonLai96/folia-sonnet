// src/components/visualizer/prompt/promptBox.ts
// 「提示词输入框」这个对话框本身：墨底框、四角定位刻线、左侧 › 提示符、右侧 ⏎ 键帽、
// 逐词方括号 + 随机 token id + 卡拉 OK 进度、字后光标、框上那行提示词，以及半随机出现的
// 铁栅栏（prompt2 那层）。**只认几何与时间**，不认歌词引擎：独立的「提示词」样式
// （createPromptPixiRuntime）用它搭自己的运行时。
//
// 商籁里那一种 prompt-field 镜头用的是 sonnet/sonnetPromptField.ts —— 同一套画法，但它直接吃
// 商籁自己的逐字排版（placements/segments/views），所以没有共用这一份。改画法要两边一起改。
//
// 坐标系：局部 (0,0) 是那一行字的中心；框、括号、光标都相对它画。

type PixiModule = typeof import('pixi.js');

/** pdoom-video 的调色板：墨底、骨白细线、信号橙。 */
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
const easeOutExpo = (value: number) => (value >= 1 ? 1 : 1 - Math.pow(2, -10 * value));
const easeInCubic = (value: number) => value * value * value;

/** 一个词在行里的位置与它被唱到的时间窗。 */
export interface PromptBoxToken {
    /** 相对行首（行最左）的偏移。 */
    left: number;
    width: number;
    startTime: number;
    endTime: number;
}

export interface PromptBoxOptions {
    tokens: readonly PromptBoxToken[];
    /** 这一行字的总宽（不含左右内边距）。 */
    rowWidth: number;
    /** 字高：内边距、键帽、光标高度都按它推。 */
    rowHeight: number;
    /** 这一句的时间窗，飞入飞出按它算。 */
    startTime: number;
    endTime: number;
    /** 框上那行提示词（AI 云缓存里随机几首歌的高亮标记）。 */
    terms: readonly string[];
    /** UI 缩放：按画面宽度算好的系数。 */
    uiScale: number;
    /** 画面尺寸：铁栅栏要铺满整屏。 */
    width: number;
    height: number;
    /** 是否带那层铁栅栏（由调用方随机决定）。 */
    withBars: boolean;
}

export interface PromptBoxFrame {
    /** 整个 shot / 整个框的位移（场景 px）。 */
    offsetX: number;
    offsetY: number;
    scale: number;
    rotation: number;
    alpha: number;
    /** 这一帧「正在唱」的那个词的序号；-1 表示没有（唱完或还没开口）。 */
    activeToken: number;
}

export interface PromptBoxView {
    /** 框体 + 逐词方括号 + token id + 键帽：垫在字下面。 */
    behind: import('pixi.js').Container;
    /** 光标 + 框上提示词 + 铁栅栏：压在字上面。 */
    front: import('pixi.js').Container;
    tokens: readonly PromptBoxToken[];
    update: (time: number) => PromptBoxFrame;
}

/**
 * 框的外廓尺寸随行宽/字高走的那几个常数。运行时在搭框之前就要知道框有多大（拿它解字号：
 * 框宽必须装进屏宽，所以字号得反过来求），所以这组算式单独提出来，两边共用一份 ——
 * 改内边距不会只改到一边。
 */
export interface PromptFieldMetrics {
    keySize: number;
    padLeft: number;
    padRight: number;
    width: number;
    height: number;
}

export const promptFieldMetrics = (rowWidth: number, rowHeight: number): PromptFieldMetrics => {
    const keySize = Math.max(9, rowHeight * 0.4);
    const padLeft = Math.max(20, rowHeight * 0.62);
    const padRight = keySize * 2 + Math.max(16, rowHeight * 0.34);
    return {
        keySize,
        padLeft,
        padRight,
        width: rowWidth + padLeft + padRight,
        // 框比那一行字高出近一倍：下面要留出方括号和 token id 的位置（pdoom 里是 60 → 128）。
        height: rowHeight * 2.05,
    };
};

export const buildPromptBox = (
    pixi: PixiModule,
    options: PromptBoxOptions,
): PromptBoxView => {
    const { Container, Graphics, Text, TextStyle } = pixi;
    const { tokens, rowWidth, rowHeight, startTime, endTime, width, height } = options;
    const u = options.uiScale;
    const bone = colorNumber(pixi, PROMPT_PALETTE.bone);
    const ash = colorNumber(pixi, PROMPT_PALETTE.ash);
    const ink = colorNumber(pixi, PROMPT_PALETTE.ink);
    const ink2 = colorNumber(pixi, PROMPT_PALETTE.ink2);
    const signal = colorNumber(pixi, PROMPT_PALETTE.signal);

    const behind = new Container();
    const front = new Container();

    const rowLeft = tokens.length ? Math.min(...tokens.map(token => token.left)) : -rowWidth / 2;
    const rowRight = tokens.length ? Math.max(...tokens.map(token => token.left + token.width)) : rowWidth / 2;

    const metrics = promptFieldMetrics(rowRight - rowLeft, rowHeight);
    const { keySize, padLeft, width: fieldWidth, height: fieldHeight } = metrics;
    const left = -fieldWidth / 2;
    const top = -fieldHeight / 2;
    const keyX = left + fieldWidth - keySize - Math.max(12, rowHeight * 0.26);

    const shape = new Graphics();
    // 墨底：字后面那一块「刻进画面」的槽。
    shape.rect(left, top, fieldWidth, fieldHeight).fill({ color: ink, alpha: 0.9 });
    shape.rect(left, top, fieldWidth, fieldHeight).stroke({ color: bone, width: 1, alpha: 0.42 });
    // 四角定位刻线
    const tick = Math.round(12 * u);
    const cornerStroke = { color: bone, width: 1, alpha: 0.6 };
    [[left, top, -1, -1], [left + fieldWidth, top, 1, -1], [left, top + fieldHeight, -1, 1], [left + fieldWidth, top + fieldHeight, 1, 1]]
        .forEach(([x, y, sx, sy]) => {
            shape.moveTo(x + sx * 5, y).lineTo(x + sx * (5 + tick), y).stroke(cornerStroke);
            shape.moveTo(x, y + sy * 5).lineTo(x, y + sy * (5 + tick)).stroke(cornerStroke);
        });
    // 提示符 ›：两条线，比字体里那个符号稳
    const promptSize = rowHeight * 0.42;
    const chevronX = left + padLeft * 0.52;
    shape.moveTo(chevronX, -promptSize * 0.42).lineTo(chevronX + promptSize * 0.48, 0)
        .lineTo(chevronX, promptSize * 0.42)
        .stroke({ color: ash, width: Math.max(1.4, 1.8 * u), alpha: 0.8 });
    behind.addChild(shape);

    // ⏎ 键帽：最后一个词开唱之前只是暗着的轮廓，之后呼吸，框被抽走时实心闪一下。
    const keycap = new Graphics();
    keycap.rect(keyX - keySize, -keySize, keySize * 2, keySize * 2)
        .stroke({ color: bone, width: Math.max(1, 1.4 * u), alpha: 0.35 });
    const arrowX = keyX + keySize * 0.42;
    const arrowY = -keySize * 0.42;
    const arrowStroke = { color: bone, width: Math.max(1, 1.6 * u), alpha: 0.7 };
    keycap.moveTo(arrowX, arrowY).lineTo(arrowX, arrowY + keySize * 0.34)
        .lineTo(arrowX - keySize * 0.78, arrowY + keySize * 0.34)
        .stroke(arrowStroke);
    keycap.moveTo(arrowX - keySize * 0.78 + keySize * 0.3, arrowY + keySize * 0.34 - keySize * 0.28)
        .lineTo(arrowX - keySize * 0.78, arrowY + keySize * 0.34)
        .lineTo(arrowX - keySize * 0.78 + keySize * 0.3, arrowY + keySize * 0.34 + keySize * 0.28)
        .stroke(arrowStroke);
    behind.addChild(keycap);
    const keyFlash = new Graphics()
        .rect(keyX - keySize, -keySize, keySize * 2, keySize * 2)
        .fill({ color: signal, alpha: 1 });
    keyFlash.alpha = 0;
    behind.addChild(keyFlash);

    // 逐词方括号 + 随机 token id + 卡拉 OK 进度：括号压在字下面，进度条沿括号走。
    const bracketY = rowHeight * 0.66;
    const hair = Math.max(1, 1.1 * u);
    const idFontSize = Math.max(8, Math.round(9 * u));
    const brackets: import('pixi.js').Graphics[] = [];
    const bracketNodes: import('pixi.js').Container[] = [];
    const idTexts: import('pixi.js').Text[] = [];
    const progressBars: import('pixi.js').Graphics[] = [];
    tokens.forEach(token => {
        const bracket = new Graphics()
            .rect(token.left, bracketY, token.width, hair).fill({ color: bone, alpha: 0.4 })
            .rect(token.left, bracketY - 5 * u, hair, 5 * u).fill({ color: bone, alpha: 0.4 })
            .rect(token.left + token.width - hair, bracketY - 5 * u, hair, 5 * u).fill({ color: bone, alpha: 0.4 });
        bracket.alpha = 0;
        const bracketNode = new Container();
        bracketNode.addChild(bracket);

        // pdoom 里每个 token 底下那串数字是「词表里的位置」，这里直接随机。
        const idText = new Text({
            text: String(Math.floor(1000 + Math.random() * 98000)),
            style: new TextStyle({ fontFamily: PROMPT_MONO_STACK, fontSize: idFontSize, fill: PROMPT_PALETTE.ash }),
        });
        idText.position.set(token.left + 1, bracketY + 4 * u);
        idText.alpha = 0;

        const bar = new Graphics()
            .rect(0, 0, 1, Math.max(2, 2.6 * u))
            .fill({ color: signal, alpha: 1 });
        bar.position.set(token.left, bracketY - 1);
        bar.scale.x = 0.001;
        bar.alpha = 0;

        brackets.push(bracket);
        bracketNodes.push(bracketNode);
        idTexts.push(idText);
        progressBars.push(bar);
        behind.addChild(bracketNode, idText, bar);
    });

    // ---- 框上那行「提示词」
    const promptFontSize = Math.max(9, Math.round(11 * u));
    const promptLine = new Text({
        text: '›',
        style: new TextStyle({
            fontFamily: PROMPT_MONO_STACK,
            fontWeight: '500',
            fontSize: promptFontSize,
            fill: PROMPT_PALETTE.bone,
            letterSpacing: 1.2,
        }),
    });
    const metricsApi = (pixi as unknown as { CanvasTextMetrics?: { measureText: (text: string, style: unknown) => { width: number } } }).CanvasTextMetrics;
    const measurePrompt = (text: string): number => {
        try {
            return metricsApi?.measureText(text, promptLine.style).width ?? text.length * promptFontSize * 0.62;
        } catch {
            return text.length * promptFontSize * 0.62;
        }
    };
    const promptPrefix = '› ';
    const promptLimit = fieldWidth * 0.92;
    let promptText = promptPrefix;
    options.terms.forEach(term => {
        const next = promptText === promptPrefix ? `${promptPrefix}${term}` : `${promptText}  ·  ${term}`;
        if (measurePrompt(next) > promptLimit) return;
        promptText = next;
    });
    promptLine.text = promptText;
    promptLine.anchor.set(0, 1);
    promptLine.position.set(left + Math.max(4, 6 * u), top - Math.max(6, 8 * u));
    promptLine.alpha = 0;
    front.addChild(promptLine);

    // 提示词末尾那个方块光标：和输入框里的光标一个节奏地闪。
    const promptCaret = new Graphics()
        .rect(0, 0, promptFontSize * 0.5, promptFontSize * 1.05)
        .fill({ color: signal, alpha: 1 });
    promptCaret.position.set(
        promptLine.position.x + promptLine.width + promptFontSize * 0.36,
        promptLine.position.y - promptFontSize * 1.05,
    );
    promptCaret.alpha = 0;
    front.addChild(promptCaret);

    // ---- 输入框里的光标
    const caret = new Graphics()
        .rect(0, 0, Math.max(2, 2.6 * u), rowHeight * 0.68)
        .fill({ color: signal, alpha: 1 });
    caret.y = -rowHeight * 0.36;
    caret.alpha = 0;
    front.addChild(caret);

    /*
     * prompt2 那层铁栅栏：一排前景竖栅栏，间距一路收窄（像一节拍逼近一格），
     * 收尾时每根柱子横向撑开，把最后一道缝也合死。
     */
    let barsLayer: import('pixi.js').Container | null = null;
    const grateBars: import('pixi.js').Graphics[] = [];
    const barWidth = width * 0.0105;
    if (options.withBars) {
        const coverHeight = Math.hypot(width, height) * 1.15;
        barsLayer = new Container();
        const barCount = Math.ceil((width * 1.5) / (width * 0.075)) + 8;
        for (let index = 0; index < barCount; index += 1) {
            const bar = new Graphics();
            // 铸铁柱：暗身子 + 左缘高光 + 右侧一道反光。
            bar.rect(-barWidth / 2, -coverHeight / 2, barWidth, coverHeight)
                .fill({ color: ink2, alpha: 0.94 });
            bar.rect(-barWidth / 2, -coverHeight / 2, barWidth * 0.22, coverHeight)
                .fill({ color: bone, alpha: 0.1 });
            bar.rect(barWidth * 0.14, -coverHeight / 2, Math.max(1, barWidth * 0.09), coverHeight)
                .fill({ color: bone, alpha: 0.2 });
            bar.visible = false;
            grateBars.push(bar);
            barsLayer.addChild(bar);
        }
        front.addChild(barsLayer);
    }

    const lastStart = tokens.length ? tokens[tokens.length - 1].startTime : startTime;
    const enterDuration = clamp((endTime - startTime) * 0.2, 0.26, 0.5);
    const exitDuration = clamp((endTime - startTime) * 0.2, 0.24, 0.42);
    const exitStart = endTime - exitDuration;

    const update = (time: number): PromptBoxFrame => {
        // 飞入：从下方压上来，边飞边摊平；飞出：最后往左上抽走，和下一个框的入场接得上。
        const enter = easeOutExpo(progressOf(time, startTime, startTime + enterDuration));
        const exit = easeInCubic(progressOf(time, exitStart, endTime));
        const offsetY = (1 - enter) * rowHeight * 1.9 - exit * rowHeight * 2.6;
        const offsetX = (1 - enter) * -fieldWidth * 0.06 - exit * fieldWidth * 0.05;
        const scale = (0.9 + 0.1 * enter) * (1 - 0.08 * exit);
        const rotation = (1 - enter) * -0.05 + exit * 0.05;
        const fadeIn = clamp01(progressOf(time, startTime, startTime + enterDuration * 0.7));
        const alpha = fadeIn * (1 - clamp01(progressOf(time, exitStart + exitDuration * 0.32, endTime)));

        promptLine.alpha = 0.62 * fadeIn * (1 - exit);
        promptCaret.alpha = promptLine.alpha * (Math.floor(time * 1.6) % 2 === 0 ? 1 : 0.15);

        // 光标位置 = 已落下的词里最靠右的那个；正在唱的那个词，光标在词里按进度走。
        let caretX = rowLeft;
        let landed = 0;
        let lastLandedStart = -Infinity;
        let activeToken = -1;
        tokens.forEach((token, index) => {
            if (token.startTime > time) return;
            const typed = progressOf(time, token.startTime, token.endTime);
            caretX = token.left + token.width * typed;
            landed += 1;
            lastLandedStart = Math.max(lastLandedStart, token.startTime);
            if (time <= token.endTime + 0.08) activeToken = index;

            const age = time - token.startTime;
            const flash = age < 0.18 ? 1 - age / 0.18 : 0;
            const decorAlpha = (0.55 + 0.45 * flash)
                * (1 - 0.35 * progressOf(time, token.endTime, token.endTime + 1.6));
            brackets[index].tint = flash > 0.25 ? signal : 0xffffff;
            bracketNodes[index].alpha = decorAlpha;
            idTexts[index].alpha = decorAlpha * 0.8;
            progressBars[index].scale.x = Math.max(0.001, token.width * typed);
            progressBars[index].alpha = (1 - 0.7 * progressOf(time, token.endTime, token.endTime + 1.2)) * fadeIn;
        });

        // 句尾之后光标停一会儿再熄灭，别跟着最后一个词一起瞬间消失。
        const caretOn = landed === 0 || time - lastLandedStart < 0.5 || Math.floor(time * 1.6) % 2 === 1;
        caret.x = caretX + Math.max(2, 2 * u);
        caret.alpha = fadeIn * (1 - exit) * (caretOn ? 1 : 0.12);

        // ⏎ 键帽：最后一个词开唱后亮起，框被抽走时按下。
        const armed = time >= lastStart + 0.1 ? 1 : 0;
        keycap.alpha = (0.45 + 0.55 * armed * (0.6 + 0.4 * Math.cos(time * Math.PI * 4))) * fadeIn;
        keyFlash.alpha = exit > 0 ? easeInCubic(progressOf(time, exitStart, exitStart + exitDuration * 0.5)) : 0;

        // 铁栅栏：越唱越挤，收尾时柱子横向撑开把缝隙合死。
        if (barsLayer) {
            const closeT = Math.pow(clamp01(progressOf(time, startTime + enterDuration * 0.6, endTime)), 0.85);
            const span = width * (0.30 - 0.215 * closeT);
            const shut = easeInCubic(progressOf(time, exitStart, exitStart + exitDuration * 0.55));
            const widen = shut * Math.max(0, (span / barWidth) * 1.02 - 1);
            const half = (grateBars.length - 1) / 2;
            grateBars.forEach((bar, index) => {
                const x = (index - half) * span;
                bar.x = x;
                bar.visible = Math.abs(x) < width * 0.75;
                bar.scale.x = 1 + widen;
            });
            const openIn = clamp01(progressOf(time, startTime, startTime + enterDuration));
            barsLayer.alpha = (0.32 + 0.68 * openIn) * (1 - exit * 0.25);
        }

        return { offsetX, offsetY, scale, rotation, alpha, activeToken };
    };

    return { behind, front, tokens, update };
};
