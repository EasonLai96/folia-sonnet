import type { Theme } from '../../../types';
import { measureText } from './sonnetTypographyLayout';
import type { SonnetTypographyPlacement } from './sonnetTypographyLayout';
import type { SegmentView } from './sonnetTextViewBuilder';
import type { SonnetSemanticSegment } from './types';
import { hashSonnetSeed } from './sonnetRandom';
import { sampleSonnetPromptTerms } from './sonnetPromptTerms';

// src/components/visualizer/sonnet/sonnetPromptField.ts
// prompt-field 镜头的「对话框」：一块刻进画面的输入框，歌词按唱到的位置逐字落进去，
// 光标跟着走，每个词下面一条方括号 + 随机的 token id，右上角一个 ⏎ 键帽在最后一个词之后亮起。
//
// 每句歌词换一个镜头，于是一个框飞走、下一个框飞进来 —— 飞入飞出的变换由 update()
// 交回给 sonnetShotFrame.ts，作用在整个 shot 上（框和字一起飞）。
//
// 视觉照搬 pdoom-video 的 prompt 场景：墨底、骨白细线、信号橙；框上的字跟着这套色，
// 由 applySonnetPromptTheme() 顶掉主题色，否则深色主题会把字淹没在墨色底上。
// 正在唱的那个词如果被 AI 主题标了高亮色（theme.wordColors），那一瞬间就用高亮色。

const INK = '#0A0A0B';
const INK2 = '#151517';
const BONE = '#EEE9DF';
const ASH = '#9C978F';
const SIGNAL = '#FF4D12';

const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const NO_TINT = 0xffffff;

/** pdoom 的三种颜色套进一个 Theme，只给这个镜头的歌词文字用。 */
export const applySonnetPromptTheme = (theme: Theme): Theme => ({
    ...theme,
    backgroundColor: INK,
    primaryColor: BONE,
    secondaryColor: ASH,
    accentColor: ASH,
    // wordColors 保留：AI 高亮落在框里也要认得出。
});

export interface SonnetPromptFieldFrame {
    /** 镜头内平移（场景 px，和字号同一坐标系）。 */
    offsetX: number;
    offsetY: number;
    scale: number;
    rotation: number;
    alpha: number;
}

export interface SonnetPromptFieldView {
    /** 框体 + 逐词方括号 + token id：垫在歌词下面。 */
    behind: import('pixi.js').Container;
    /** 光标 + 框上那行提示词：压在歌词上面。 */
    front: import('pixi.js').Container;
    update: (time: number) => SonnetPromptFieldFrame;
}

export interface SonnetPromptFieldOptions {
    width: number;
    height: number;
    seed: number;
    shotStartTime: number;
    shotEndTime: number;
    baseFontSize: number;
    placements: readonly SonnetTypographyPlacement[];
    segments: readonly SonnetSemanticSegment[];
    /** 已经搭好的逐段文字视图：用来给正在唱的那个词上 AI 高亮色。 */
    views: readonly SegmentView[];
    theme: Theme;
}

type PixiModule = typeof import('pixi.js');

const colorNumber = (pixi: PixiModule, color: string) => pixi.Color.shared.setValue(color).toNumber();
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const progressOf = (time: number, start: number, end: number) => (
    end <= start ? (time >= end ? 1 : 0) : clamp01((time - start) / (end - start))
);
const easeOutExpo = (value: number) => (value >= 1 ? 1 : 1 - Math.pow(2, -10 * value));
const easeInCubic = (value: number) => value * value * value;

type GlyphRef = SegmentView['glyphs'][number];

interface PromptToken {
    left: number;
    width: number;
    startTime: number;
    endTime: number;
    bracket: import('pixi.js').Graphics;
    bracketNode: import('pixi.js').Container;
    bar: import('pixi.js').Graphics;
    idText: import('pixi.js').Text;
    /** AI 主题给这个词标的高亮色；没有高亮就是 null。 */
    highlight: number | null;
    glyphs: GlyphRef[];
}

export const buildSonnetPromptField = (
    pixi: PixiModule,
    options: SonnetPromptFieldOptions,
): SonnetPromptFieldView => {
    const { Container, Graphics, Text, TextStyle } = pixi;
    const { width, shotStartTime, shotEndTime, placements, segments, seed } = options;
    const u = clamp(width / 420, 0.8, 1.5);

    const behind = new Container();
    const front = new Container();

    const viewBySegment = new Map(options.views.map(view => [view.segmentIndex, view]));
    const highlightOf = (text: string): number | null => {
        const needle = text.trim().toLowerCase();
        if (!needle) return null;
        const hit = options.theme.wordColors?.find(entry => (
            String(entry?.word ?? '').trim().toLowerCase() === needle
        ));
        return hit?.color ? colorNumber(pixi, hit.color) : null;
    };

    const tokens: PromptToken[] = [];
    placements.forEach(placement => {
        const segment = segments[placement.segmentIndex];
        if (!segment || !segment.text.trim() || segment.text === '♪') return;
        const left = placement.x - placement.measuredWidth / 2;
        tokens.push({
            // 词与词之间的空格算在词宽里，括号贴着字走，所以两端各收一点。
            left: left + 1,
            width: Math.max(2, placement.measuredWidth - 2),
            startTime: segment.startTime,
            endTime: Math.max(segment.endTime, segment.startTime + 0.08),
            bracket: new Graphics(),
            bracketNode: new Container(),
            bar: new Graphics(),
            idText: new Text({ text: '' }),
            highlight: highlightOf(segment.text),
            glyphs: viewBySegment.get(placement.segmentIndex)?.glyphs ?? [],
        });
    });

    // 一行字的总宽度（含词间空隙）：由实测盒子还原，输入框据此收放。
    const rowLeft = tokens.length ? Math.min(...tokens.map(token => token.left)) : -width * 0.2;
    const rowRight = tokens.length ? Math.max(...tokens.map(token => token.left + token.width)) : width * 0.2;
    const rowWidth = Math.max(rowRight - rowLeft, options.baseFontSize * 1.2);
    const rowHeight = Math.max(
        options.baseFontSize * 1.2,
        ...placements.map(placement => placement.measuredHeight),
    );

    // 框比那一行字高出近一倍：下面要留出方括号和 token id 的位置（pdoom 里是 60 → 128）。
    const fieldHeight = rowHeight * 2.05;
    const keySize = Math.max(9, rowHeight * 0.4);
    const padLeft = Math.max(20, rowHeight * 0.62);
    const padRight = keySize * 2 + Math.max(16, rowHeight * 0.34);
    const fieldWidth = rowWidth + padLeft + padRight;
    const left = -fieldWidth / 2;
    const top = -fieldHeight / 2;
    const keyX = left + fieldWidth - keySize - Math.max(12, rowHeight * 0.26);

    const shape = new Graphics();
    // 墨底：字后面那一块「刻进画面」的槽。
    shape.rect(left, top, fieldWidth, fieldHeight).fill({ color: colorNumber(pixi, INK), alpha: 0.9 });
    shape.rect(left, top, fieldWidth, fieldHeight).stroke({
        color: colorNumber(pixi, BONE),
        width: 1,
        alpha: 0.42,
    });
    // 四角定位刻线
    const tick = Math.round(12 * u);
    const cornerStroke = { color: colorNumber(pixi, BONE), width: 1, alpha: 0.6 };
    [[left, top, -1, -1], [left + fieldWidth, top, 1, -1], [left, top + fieldHeight, -1, 1], [left + fieldWidth, top + fieldHeight, 1, 1]]
        .forEach(([x, y, sx, sy]) => {
            shape.moveTo(x + sx * 5, y).lineTo(x + sx * (5 + tick), y).stroke(cornerStroke);
            shape.moveTo(x, y + sy * 5).lineTo(x, y + sy * (5 + tick)).stroke(cornerStroke);
        });
    // 提示符 ›：两条线，比字体里那个符号稳
    const promptSize = rowHeight * 0.42;
    const caretX0 = left + padLeft * 0.52;
    shape.moveTo(caretX0, -promptSize * 0.42).lineTo(caretX0 + promptSize * 0.48, 0)
        .lineTo(caretX0, promptSize * 0.42)
        .stroke({ color: colorNumber(pixi, ASH), width: Math.max(1.4, 1.8 * u), alpha: 0.8 });
    behind.addChild(shape);

    // ⏎ 键帽：最后一个词开唱之前只是暗着的轮廓，之后开始呼吸，框被抽走时实心闪一下。
    const keycap = new Graphics();
    keycap.rect(keyX - keySize, -keySize, keySize * 2, keySize * 2).stroke({
        color: colorNumber(pixi, BONE),
        width: Math.max(1, 1.4 * u),
        alpha: 0.35,
    });
    const arrowX = keyX + keySize * 0.42;
    const arrowY = -keySize * 0.42;
    const arrowStroke = { color: colorNumber(pixi, BONE), width: Math.max(1, 1.6 * u), alpha: 0.7 };
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
        .fill({ color: colorNumber(pixi, SIGNAL), alpha: 1 });
    keyFlash.alpha = 0;
    behind.addChild(keyFlash);

    // 逐词方括号 + 随机 token id + 卡拉 OK 进度：括号压在字下面，进度条沿括号走。
    const bracketY = rowHeight * 0.66;
    const hair = Math.max(1, 1.1 * u);
    const idFontSize = Math.max(8, Math.round(9 * u));
    const bracketColor = colorNumber(pixi, BONE);
    tokens.forEach(token => {
        token.bracket
            .rect(token.left, bracketY, token.width, hair).fill({ color: bracketColor, alpha: 0.4 })
            .rect(token.left, bracketY - 5 * u, hair, 5 * u).fill({ color: bracketColor, alpha: 0.4 })
            .rect(token.left + token.width - hair, bracketY - 5 * u, hair, 5 * u).fill({ color: bracketColor, alpha: 0.4 });
        token.bracket.alpha = 0;
        token.bracketNode.addChild(token.bracket);

        // pdoom 里每个 token 底下那串数字是「词表里的位置」，这里直接随机。
        token.idText.text = String(Math.floor(1000 + Math.random() * 98000));
        token.idText.style = new TextStyle({
            fontFamily: MONO_STACK,
            fontSize: idFontSize,
            fill: ASH,
        });
        token.idText.position.set(token.left + 1, bracketY + 4 * u);
        token.idText.alpha = 0;

        token.bar
            .rect(0, 0, 1, Math.max(2, 2.6 * u))
            .fill({ color: colorNumber(pixi, SIGNAL), alpha: 1 });
        token.bar.position.set(token.left, bracketY - 1);
        token.bar.scale.x = 0.001;
        token.bar.alpha = 0;

        behind.addChild(token.bracketNode, token.idText, token.bar);
    });

    // ---- 框上那行「提示词」：AI 云缓存里随机几首歌的高亮标记
    const promptTerms = sampleSonnetPromptTerms(options.theme, hashSonnetSeed(`prompt-terms:${seed}`), 5);
    const promptFontSize = Math.max(9, Math.round(11 * u));
    const promptFontSpec = `500 ${promptFontSize}px ${MONO_STACK}`;
    const promptPrefix = '› ';
    let promptText = promptPrefix;
    const promptLimit = fieldWidth * 0.92;
    promptTerms.forEach(term => {
        const next = promptText === promptPrefix ? `${promptPrefix}${term}` : `${promptText}  ·  ${term}`;
        if (measureText(next, promptFontSpec, promptFontSize) > promptLimit) return;
        promptText = next;
    });
    const promptLine = new Text({
        text: promptText,
        style: new TextStyle({
            fontFamily: MONO_STACK,
            fontWeight: '500',
            fontSize: promptFontSize,
            fill: BONE,
            letterSpacing: 1.2,
        }),
    });
    promptLine.anchor.set(0, 1);
    promptLine.position.set(left + Math.max(4, 6 * u), top - Math.max(6, 8 * u));
    promptLine.alpha = 0;
    front.addChild(promptLine);

    // 提示词末尾那个方块光标：和输入框里的光标一个节奏地闪。
    const promptCaret = new Graphics()
        .rect(0, 0, promptFontSize * 0.5, promptFontSize * 1.05)
        .fill({ color: colorNumber(pixi, SIGNAL), alpha: 1 });
    promptCaret.position.set(
        promptLine.position.x + promptLine.width + promptFontSize * 0.36,
        promptLine.y - promptFontSize * 1.05,
    );
    promptCaret.alpha = 0;
    front.addChild(promptCaret);

    // ---- 输入框里的光标
    const caret = new Graphics()
        .rect(0, 0, Math.max(2, 2.6 * u), rowHeight * 0.68)
        .fill({ color: colorNumber(pixi, SIGNAL), alpha: 1 });
    caret.y = -rowHeight * 0.36;
    caret.alpha = 0;
    front.addChild(caret);

    /*
     * prompt2 那层铁栅栏：一半的框会带上一排前景竖栅栏 —— 间距一路收窄（像一节拍逼近一格），
     * 收尾时每根柱子横向撑开，把最后一道路缝也合死。随机由 seed 决定，一个框带、下一个不带。
     */
    const withBars = hashSonnetSeed(`prompt-bars:${seed}`) % 2 === 1;
    const bars: import('pixi.js').Graphics[] = [];
    let barsLayer: import('pixi.js').Container | null = null;
    const barWidth = width * 0.0105;
    if (withBars) {
        const coverHeight = Math.hypot(width, options.height) * 1.15;
        barsLayer = new Container();
        const barCount = Math.ceil((width * 1.5) / (width * 0.075)) + 8;
        for (let index = 0; index < barCount; index += 1) {
            const bar = new Graphics();
            // 铸铁柱：暗身子 + 左缘高光 + 右侧一道反光，全靠三条竖条糊出来。
            bar.rect(-barWidth / 2, -coverHeight / 2, barWidth, coverHeight)
                .fill({ color: colorNumber(pixi, INK2), alpha: 0.94 });
            bar.rect(-barWidth / 2, -coverHeight / 2, barWidth * 0.22, coverHeight)
                .fill({ color: colorNumber(pixi, BONE), alpha: 0.1 });
            bar.rect(barWidth * 0.14, -coverHeight / 2, Math.max(1, barWidth * 0.09), coverHeight)
                .fill({ color: colorNumber(pixi, BONE), alpha: 0.2 });
            bar.visible = false;
            bars.push(bar);
            barsLayer.addChild(bar);
        }
        front.addChild(barsLayer);
    }

    const lastStart = tokens.length ? tokens[tokens.length - 1].startTime : shotStartTime;
    const enterDuration = clamp((shotEndTime - shotStartTime) * 0.2, 0.26, 0.5);
    const exitDuration = clamp((shotEndTime - shotStartTime) * 0.2, 0.24, 0.42);
    const exitStart = shotEndTime - exitDuration;
    const signalNumber = colorNumber(pixi, SIGNAL);

    // 高亮染色只作用在「正在唱」的那一个词上：换词时把上一个复原，
    // 免得上色要每帧遍历所有字形（一个框里十几个词、几十个字形）。
    let tintedToken = -1;
    const applyHighlight = (index: number) => {
        if (tintedToken === index) return;
        const previous = tokens[tintedToken];
        previous?.glyphs.forEach(glyph => { glyph.display.tint = NO_TINT; });
        const next = tokens[index];
        if (next?.highlight != null) {
            next.glyphs.forEach(glyph => { glyph.display.tint = next.highlight!; });
        }
        tintedToken = index;
    };

    const update = (time: number): SonnetPromptFieldFrame => {
        // 飞入：从下方压上来，边飞边摊平；飞出：最后往左上抽走，和下一个框的入场接得上。
        const enter = easeOutExpo(progressOf(time, shotStartTime, shotStartTime + enterDuration));
        const exit = easeInCubic(progressOf(time, exitStart, shotEndTime));
        const offsetY = (1 - enter) * rowHeight * 1.9 - exit * rowHeight * 2.6;
        const offsetX = (1 - enter) * -fieldWidth * 0.06 - exit * fieldWidth * 0.05;
        const scale = (0.9 + 0.1 * enter) * (1 - 0.08 * exit);
        const rotation = (1 - enter) * -0.05 + exit * 0.05;
        const fadeIn = clamp01(progressOf(time, shotStartTime, shotStartTime + enterDuration * 0.7));
        const alpha = fadeIn * (1 - clamp01(progressOf(time, exitStart + exitDuration * 0.32, shotEndTime)));

        promptLine.alpha = 0.62 * fadeIn * (1 - exit);
        promptCaret.alpha = promptLine.alpha * (Math.floor(time * 1.6) % 2 === 0 ? 1 : 0.15);

        // 光标位置 = 已落下的词里最靠右的那个；正在唱的那个词，光标在词里按进度走。
        let caretX = rowLeft;
        let landed = 0;
        let lastLandedStart = -Infinity;
        let highlightIndex = -1;
        tokens.forEach((token, index) => {
            if (token.startTime > time) return;
            const typed = progressOf(time, token.startTime, token.endTime);
            caretX = token.left + token.width * typed;
            landed += 1;
            lastLandedStart = Math.max(lastLandedStart, token.startTime);
            // 正在唱（含收尾那一点点余温）且被 AI 标过高亮的，就是这一帧要上色的词。
            if (token.highlight !== null && time <= token.endTime + 0.08) highlightIndex = index;

            const age = time - token.startTime;
            const flash = age < 0.18 ? 1 - age / 0.18 : 0;
            const decorAlpha = (0.55 + 0.45 * flash)
                * (1 - 0.35 * progressOf(time, token.endTime, token.endTime + 1.6));
            token.bracket.tint = flash > 0.25 ? signalNumber : NO_TINT;
            token.bracketNode.alpha = decorAlpha;
            token.idText.alpha = decorAlpha * 0.8;
            token.bar.scale.x = Math.max(0.001, token.width * typed);
            token.bar.alpha = (1 - 0.7 * progressOf(time, token.endTime, token.endTime + 1.2)) * fadeIn;
        });
        applyHighlight(highlightIndex);

        // 句尾之后光标停一会儿再熄灭，别跟着最后一个词一起瞬间消失。
        const caretIdle = time - lastLandedStart;
        const caretOn = landed === 0 || caretIdle < 0.5 || Math.floor(time * 1.6) % 2 === 1;
        caret.x = caretX + Math.max(2, 2 * u);
        caret.alpha = fadeIn * (1 - exit) * (caretOn ? 1 : 0.12);

        // ⏎ 键帽：最后一个词开唱后亮起，框被抽走时按下。
        const armed = time >= lastStart + 0.1 ? 1 : 0;
        keycap.alpha = (0.45 + 0.55 * armed * (0.6 + 0.4 * Math.cos(time * Math.PI * 4))) * fadeIn;
        keyFlash.alpha = exit > 0 ? easeInCubic(progressOf(time, exitStart, exitStart + exitDuration * 0.5)) : 0;

        // 铁栅栏：越唱越挤，收尾时柱子横向撑开把缝隙合死。
        if (barsLayer) {
            const closeT = Math.pow(clamp01(progressOf(time, shotStartTime + enterDuration * 0.6, shotEndTime)), 0.85);
            const span = width * (0.30 - 0.215 * closeT);
            const shut = easeInCubic(progressOf(time, exitStart, exitStart + exitDuration * 0.55));
            const widen = shut * Math.max(0, (span / barWidth) * 1.02 - 1);
            const half = (bars.length - 1) / 2;
            bars.forEach((bar, index) => {
                const x = (index - half) * span;
                bar.x = x;
                bar.visible = Math.abs(x) < width * 0.75;
                bar.scale.x = 1 + widen;
            });
            const openIn = clamp01(progressOf(time, shotStartTime, shotStartTime + enterDuration));
            barsLayer.alpha = (0.32 + 0.68 * openIn) * (1 - exit * 0.25);
        }

        return { offsetX, offsetY, scale, rotation, alpha };
    };

    return { behind, front, update };
};
