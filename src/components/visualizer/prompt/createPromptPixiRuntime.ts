import type { MotionValue } from 'framer-motion';
import type { Theme } from '../../../types';
import { loadPixi } from '../pixi/loadPixi';
import { makePixiContext } from '../pixi/pixiWebGLContext';
import { linkPixiPrograms } from '../pixi/pixiProgramLinks';
import {
    buildPromptCard,
    PROMPT_MONO_STACK,
    PROMPT_PALETTE,
    type PromptCardView,
} from './promptBox';
import type { PromptBoxPlan } from './promptProgram';
import { promptVocabPick } from './promptVocab';

// src/components/visualizer/prompt/createPromptPixiRuntime.ts
// 「提示词」样式自己的 Pixi 运行时。它不认商籁那套节目单（场景 / 镜头 / 排版），只做三件事：
//
//   1. 收下 promptProgram 编译好的节目单（一句一个框）；
//   2. 按播放时间挑出此刻该在台上的那一句，交给 promptBox 搭出「候选面板 + 桌面歌词悬浮条」；
//   3. 每个词一个 pixi.Text，唱到才落下；**字号固定**（跟窗高走，不按内容反解），
//      一行字超出窗宽才横向跟随 —— 这就是「不要强制放大，超过范围才跟随」。
//
// 坐标：画面 px。root 只把整组摆到画面正中；字在窗内滚动，不做推拉缩放。
type PixiModule = typeof import('pixi.js');

/** 量宽用的参考字号：先按 100 量出逐词宽度，再按真实字号线性缩放。 */
const FONT_BASE = 100;
/** 词间距占字号的比例。 */
const WORD_GAP_RATIO = 0.34;
/** 一个词从「没出现」到「全亮」用多久。 */
const WORD_REVEAL_S = 0.09;
/** 横向跟随：唱到的字留在窗内这个位置（0.62 = 从左往右 62% 处）。 */
const FOLLOW_ANCHOR = 0.62;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const progressOf = (time: number, start: number, end: number) => (
    end <= start ? (time >= end ? 1 : 0) : clamp01((time - start) / (end - start))
);
const easeOutExpo = (value: number) => (value >= 1 ? 1 : 1 - Math.pow(2, -10 * value));
const easeInCubic = (value: number) => value * value * value;

/**
 * 主题色 → pixi 色号。**必须提亮到看得见**：AI 主题的 primaryColor 常常是近黑的深色，
 * 直接拿去画字就是「黑底黑字」—— 看起来和没画一样，而且不报错。所以按亮度兜一道底，
 * 太暗就往骨白提，保住色相。
 */
const themeColor = (pixi: PixiModule, value: string | undefined, fallback: string, minLum: number): number => {
    const shared = pixi.Color.shared;
    let color: import('pixi.js').Color;
    try {
        color = shared.setValue(value || fallback);
    } catch {
        color = shared.setValue(fallback);
    }
    const { red, green, blue } = color;
    const lum = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    if (!Number.isFinite(lum)) return shared.setValue(fallback).toNumber();
    if (lum >= minLum) return color.toNumber();
    const lift = (minLum + 0.08 - lum) / Math.max(1e-4, 1 - lum);
    return shared.setValue([
        red + (0.95 - red) * lift,
        green + (0.95 - green) * lift,
        blue + (0.95 - blue) * lift,
    ]).toNumber();
};

/** 一首歌的全部输入。整体换掉意味着换歌。 */
export interface PromptSongContext {
    seed: string | number | undefined;
    boxes: PromptBoxPlan[];
    theme: Theme;
}

export interface PromptRuntimeOptions {
    host: HTMLDivElement;
    song: PromptSongContext;
    currentTime: MotionValue<number>;
    paused: boolean;
    /** 减少动感：不做进场位移。 */
    staticMode: boolean;
    signal?: AbortSignal;
}

/** 一个词在行里的位置（px，0 = 窗内字的起点）与它被唱到的窗口。 */
interface WordBox {
    text: string;
    left: number;
    width: number;
    startTime: number;
    endTime: number;
}

interface BuiltWord {
    node: import('pixi.js').Text;
    box: WordBox;
    /** AI 给这个词标的颜色（没有就是 null）。 */
    color: number | null;
}

interface BuiltBox {
    /** 画面中心。 */
    root: import('pixi.js').Container;
    card: PromptCardView;
    words: BuiltWord[];
    caret: import('pixi.js').Graphics;
    tokens: WordBox[];
    fontPx: number;
    /** 整行宽（px）：超出窗宽才需要横向跟随。 */
    rowWidth: number;
    startTime: number;
    endTime: number;
}

export class PromptPixiRuntime {
    private readonly boxes = new Map<number, BuiltBox>();
    private destroyed = false;
    private resizeObserver: ResizeObserver | null = null;
    private lastWidth = 0;
    private lastHeight = 0;

    private stage!: import('pixi.js').Container;

    private constructor(
        private readonly pixi: PixiModule,
        private readonly options: PromptRuntimeOptions,
        private readonly app: import('pixi.js').Application,
    ) { }

    static async create(options: PromptRuntimeOptions) {
        const pixi = await loadPixi();
        // 窗是自己画墨底的，画布本身要透明（底下是 VisualizerShell 的背景）。
        const contextOptions = {
            backgroundAlpha: 0,
            antialias: true,
            powerPreference: 'high-performance',
        } as const;
        const context = await makePixiContext(pixi, contextOptions, options.signal);
        const app = new pixi.Application();
        const width = Math.max(options.host.clientWidth, 320);
        const height = Math.max(options.host.clientHeight, 240);
        await app.init({
            width,
            height,
            ...contextOptions,
            ...context,
            autoDensity: true,
            resolution: clamp(window.devicePixelRatio || 1, 1, 2),
            autoStart: false,
            sharedTicker: false,
            preference: 'webgl',
        });
        const runtime = new PromptPixiRuntime(pixi, options, app);
        runtime.stage = new pixi.Container();
        app.stage.addChild(runtime.stage);

        if (options.signal?.aborted) {
            runtime.destroy();
            throw new DOMException('Prompt runtime creation was cancelled', 'AbortError');
        }
        await runtime.install();
        if (options.signal?.aborted) {
            runtime.destroy();
            throw new DOMException('Prompt runtime creation was cancelled', 'AbortError');
        }
        return runtime;
    }

    /**
     * 首帧分几个任务做：先按真实尺寸搭好第一个框并画一帧，再让程序在页面继续跑的时候链接，
     * 最后才把画布挂进页面。和商籁同一条路径（见 pixiProgramLinks）。
     */
    private async install() {
        await new Promise((resolve) => { window.setTimeout(resolve); });
        if (this.options.signal?.aborted) return;
        this.resizeToHost();
        this.renderFrame();
        await linkPixiPrograms(this.pixi, this.app.renderer, this.app.stage, 'Prompt', this.options.signal);
        if (this.options.signal?.aborted) return;
        this.options.host.appendChild(this.app.canvas);
        this.app.canvas.style.cssText = 'width:100%;height:100%;display:block';
        this.app.ticker.add(this.renderFrame);
        this.resizeObserver = new ResizeObserver(() => {
            if (this.destroyed || !this.resizeToHost()) return;
            if (this.options.paused) this.renderOnce();
        });
        this.resizeObserver.observe(this.options.host);
        this.app.renderer.render(this.app.stage);
        if (!this.options.paused) this.app.start();
    }

    private resizeToHost() {
        if (this.destroyed) return false;
        const width = Math.max(this.options.host.clientWidth, 320);
        const height = Math.max(this.options.host.clientHeight, 240);
        if (width === this.lastWidth && height === this.lastHeight) return false;
        this.lastWidth = width;
        this.lastHeight = height;
        this.app.renderer.resize(width, height);
        // 窗宽、字号、遮罩都按屏宽解，尺寸一变就得重搭。
        this.clearBoxes();
        return true;
    }

    private clearBoxes() {
        this.boxes.forEach(box => this.destroyBox(box));
        this.boxes.clear();
    }

    private destroyBox(box: BuiltBox) {
        this.stage.removeChild(box.root);
        // 逐节点销毁：destroy({children:true}) 会留下每个 Text 自建纹理的引用。
        box.words.forEach(word => word.node.destroy());
        box.caret.destroy();
        box.card.root.destroy({ children: true });
        box.root.destroy({ children: false });
    }

    /** 主题字色与强调色：每搭一次框读一次（主题换了下一次搭框就跟上）。 */
    private palette() {
        const { theme } = this.options.song;
        return {
            text: themeColor(this.pixi, theme?.primaryColor, PROMPT_PALETTE.bone, 0.62),
            accent: themeColor(this.pixi, theme?.accentColor, PROMPT_PALETTE.signal, 0.4),
        };
    }

    /** 窗宽：与屏宽成比例，够宽才像「桌面歌词条」。 */
    private boxWidth() {
        return clamp(this.lastWidth * 0.9, 260, 900);
    }

    /**
     * 一句的量宽：按 FONT_BASE 量一次，再按真实字号线性缩放。
     * **字号不反解** —— 长句不压小字，靠后面的横向跟随解决。
     */
    private layoutRow(plan: PromptBoxPlan, fontPx: number) {
        const { TextStyle } = this.pixi;
        const measureStyle = new TextStyle({
            fontFamily: PROMPT_MONO_STACK,
            fontWeight: '600',
            fontSize: FONT_BASE,
        });
        const metricsApi = (this.pixi as unknown as {
            CanvasTextMetrics?: { measureText: (text: string, style: unknown) => { width: number } };
        }).CanvasTextMetrics;
        /*
         * 量宽必须拿**真的 TextStyle 实例**。CanvasTextMetrics.measureText 是从 style 上读
         * `letterSpacing` / `_fontString` / `styleKey` 的：给一个普通对象，letterSpacing 是
         * undefined，(字数-1) * undefined = NaN，量出来的宽度就是 NaN，整行字和窗一起消失。
         */
        const measure = (text: string): number => {
            try {
                // 量不到（字体没就绪 / API 不可用）一律按字数估：宁可字宽估歪，不能让整行消失。
                const width = metricsApi ? metricsApi.measureText(text, measureStyle).width : Number.NaN;
                return Number.isFinite(width) && width > 0 ? width : text.length * FONT_BASE * 0.62;
            } catch {
                return text.length * FONT_BASE * 0.62;
            }
        };
        const scale = fontPx / FONT_BASE;
        const gap = fontPx * WORD_GAP_RATIO;
        const tokens: WordBox[] = [];
        let cursor = 0;
        plan.words.forEach(word => {
            const width = measure(word.text) * scale;
            tokens.push({
                text: word.text,
                left: cursor,
                width,
                startTime: word.startTime,
                endTime: word.endTime,
            });
            cursor += width + gap;
        });
        const last = tokens[tokens.length - 1];
        return { tokens, rowWidth: last ? last.left + last.width : 0 };
    }

    /** 词 → 高亮色。整行同色会很花，所以只给「被 AI 标过的词」备一份。 */
    private highlighter() {
        const byWord = new Map<string, number>();
        (this.options.song.theme?.wordColors ?? []).forEach(entry => {
            const word = String(entry?.word ?? '').trim();
            if (!word) return;
            byWord.set(word, themeColor(this.pixi, entry?.color, PROMPT_PALETTE.bone, 0.55));
        });
        return (text: string): number | null => byWord.get(text.trim()) ?? null;
    }

    private buildBox(plan: PromptBoxPlan, index: number): BuiltBox {
        const { Container, Graphics, Text, TextStyle } = this.pixi;
        const colors = this.palette();
        const height = Math.max(240, this.lastHeight);

        const root = new Container();
        root.position.set(this.lastWidth / 2, height / 2);

        /*
         * 候选面板那三行陪衬：从 30000 词的词表里按这句的种子抽三个中文词。
         * 槽位从 2 起 —— 0/1 已经被窗底那两个「token id」占了，错开才像同一批候选。
         */
        const candidates = [2, 3, 4].map(slot => promptVocabPick(plan.vocabSeed, slot).text);
        const card = buildPromptCard(this.pixi, {
            width: this.boxWidth(),
            accent: colors.accent,
            textColor: colors.text,
            seed: plan.vocabSeed,
            lineIndex: index + 1,
            tokens: plan.words.map(word => ({ text: word.text, startTime: word.startTime, endTime: word.endTime })),
            candidates,
        });
        root.addChild(card.root);

        const { tokens, rowWidth } = this.layoutRow(plan, card.fontPx);
        /*
         * 字：白色纹理 + tint —— 主题色、AI 高亮色都只是换个 tint，不用重烤纹理。
         * 发光用 dropShadow（canvas 的 shadowBlur，distance 0）烤进同一张纹理，比复制一层字
         * 挂 BlurFilter 便宜得多；padding 给光晕留位置，字形会因此内缩，所以每个词往左补回去。
         */
        const wordPad = Math.round(clamp(card.fontPx * 0.09, 6, 40));
        const wordStyle = new TextStyle({
            fontFamily: PROMPT_MONO_STACK,
            fontWeight: '600',
            fontSize: card.fontPx,
            fill: '#ffffff',
            padding: wordPad,
            dropShadow: {
                color: '#ffffff',
                alpha: 0.7,
                blur: Math.max(6, card.fontPx * 0.055),
                distance: 0,
                angle: 0,
            },
        });

        const highlightOf = this.highlighter();
        const words: BuiltWord[] = tokens.map(token => {
            // resolution 1：字大到几十上百 px，按设备像素比烤纹理一张就是好几兆；带发光看不出软。
            const node = new Text({ text: token.text, style: wordStyle, resolution: 1 });
            node.anchor.set(0, 0.5);
            node.position.set(token.left - wordPad, 0);
            node.visible = false;
            return { node, box: token, color: highlightOf(token.text) };
        });
        words.forEach(word => card.textLayer.addChild(word.node));

        const caret = new Graphics()
            .rect(0, 0, Math.max(2, card.fontPx * 0.045), card.fontPx * 0.78)
            .fill({ color: colors.accent, alpha: 1 });
        caret.pivot.set(0, card.fontPx * 0.39);
        caret.alpha = 0;
        card.textLayer.addChild(caret);

        this.stage.addChild(root);
        return {
            root,
            card,
            words,
            caret,
            tokens,
            fontPx: card.fontPx,
            rowWidth,
            startTime: plan.startTime,
            endTime: plan.endTime,
        };
    }

    /** 此刻台上是第几句：取「最后一个已经开唱」的；都还没到就是第一句（它自己还在场外，画不出来）。 */
    private indexAt(time: number) {
        const { boxes } = this.options.song;
        let index = 0;
        for (let cursor = 0; cursor < boxes.length; cursor += 1) {
            if (boxes[cursor].startTime <= time) index = cursor;
            else break;
        }
        return index;
    }

    private ensure(index: number): BuiltBox | null {
        const existing = this.boxes.get(index);
        if (existing) return existing;
        const plan = this.options.song.boxes[index];
        if (!plan) return null;
        const built = this.buildBox(plan, index);
        this.boxes.set(index, built);
        return built;
    }

    private prune(active: number) {
        this.boxes.forEach((box, index) => {
            if (Math.abs(index - active) <= 2) return;
            this.destroyBox(box);
            this.boxes.delete(index);
        });
    }

    /** 一整句的姿势：字的落下与高亮、窗内横向跟随。 */
    private updateBox(box: BuiltBox, time: number, staticMode: boolean) {
        const { startTime, endTime, tokens, fontPx, card } = box;
        // 帧值兜底：时间窗坏了（云端歌词偶尔会有缺 endTime 的行）会算出 NaN，
        // 而 alpha 一旦是 NaN，visible 就永远为 false —— 空屏，且没有任何报错。
        const safe = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

        const span = Math.max(0.2, endTime - startTime);
        const enterDuration = clamp(span * 0.2, 0.26, 0.5);
        const exitDuration = clamp(span * 0.2, 0.24, 0.42);
        const exitStart = endTime - exitDuration;
        const enter = easeOutExpo(progressOf(time, startTime, startTime + enterDuration));
        const exit = easeInCubic(progressOf(time, exitStart, endTime));
        const fadeIn = clamp01(progressOf(time, startTime, startTime + enterDuration * 0.7));
        const alpha = fadeIn * (1 - clamp01(progressOf(time, exitStart + exitDuration * 0.32, endTime)));

        // 唱到哪儿：光标位置 = 已落下的词里最靠右的那个；正在唱的那个词，光标在词里按进度走。
        let caretX = tokens[0]?.left ?? 0;
        let activeToken = -1;
        tokens.forEach((token, index) => {
            if (token.startTime > time) return;
            caretX = token.left + token.width * progressOf(time, token.startTime, token.endTime);
            if (time <= token.endTime + 0.1) activeToken = index;
        });
        const lastStart = tokens[tokens.length - 1]?.startTime ?? startTime;

        // 整组：进场很轻地往上一浮，退场略微下沉；**不缩放、不推拉**。
        if (staticMode) {
            box.root.position.set(this.lastWidth / 2, this.lastHeight / 2);
            box.root.alpha = time >= (tokens[0]?.startTime ?? startTime) - 0.2 ? 1 : 0;
        } else {
            box.root.position.set(
                this.lastWidth / 2,
                this.lastHeight / 2 + safe((1 - enter) * this.lastHeight * 0.03 - exit * this.lastHeight * 0.04, 0),
            );
            box.root.alpha = safe(alpha, 0);
        }
        box.root.visible = box.root.alpha > 0.004;

        /*
         * 横向跟随：**只有整行超出窗宽才动**。字装得下就一动不动（这就是「不要强制放大」），
         * 装不下就把唱到的字钉在窗内 62% 的位置，其余从它两边流过去，像桌面歌词那样滚。
         */
        const maxScroll = Math.max(0, box.rowWidth - card.textWidth);
        const scroll = maxScroll > 0
            ? clamp(caretX - card.textWidth * FOLLOW_ANCHOR, 0, maxScroll)
            : 0;
        card.textLayer.x = card.textOriginX - safe(scroll, 0);

        /*
         * 字：唱到才落下；**唱过的高亮色留着不还回去** —— 一句唱完整行都是亮的。
         * AI 标过色的词用它自己的色，其余用主题强调色。
         */
        const colors = this.palette();
        box.words.forEach(word => {
            const appear = clamp01((time - word.box.startTime) / WORD_REVEAL_S);
            word.node.visible = appear > 0;
            if (!word.node.visible) return;
            word.node.alpha = appear;
            word.node.y = (1 - appear) * fontPx * 0.14;
            const tint = time >= word.box.startTime ? (word.color ?? colors.accent) : colors.text;
            if (word.node.tint !== tint) word.node.tint = tint;
        });

        // 光标：唱到哪儿跟到哪儿；句尾之后先亮半秒再闪。
        const blinkOn = time - lastStart < 0.5 || Math.floor(time * 1.6) % 2 === 1;
        box.caret.x = caretX + fontPx * 0.06;
        box.caret.alpha = blinkOn ? 1 : 0.12;

        card.update(time, activeToken, progressOf(time, startTime, endTime));
    }

    private renderFrame = () => {
        if (this.destroyed) return;
        if (this.lastWidth <= 0 || this.lastHeight <= 0) return;
        const { boxes } = this.options.song;
        if (boxes.length === 0) {
            this.stage.visible = false;
            return;
        }
        this.stage.visible = true;
        const time = this.options.currentTime.get();
        const active = this.indexAt(time);
        const current = this.ensure(active);
        // 上一句还在演它的退场（整组在句尾抽走），所以两块一起驱动；它们各自按绝对时间算姿势。
        const previous = active > 0 ? this.ensure(active - 1) : null;
        this.prune(active);

        const staticMode = this.options.staticMode;
        if (current) this.updateBox(current, time, staticMode);
        if (previous) this.updateBox(previous, time, staticMode);
        this.boxes.forEach((box, index) => {
            if (index !== active && index !== active - 1 && box.root.visible) box.root.visible = false;
        });
    };

    /**
     * 换一首歌：节目单整体换掉、缓存清空。
     *
     * 这里**不做整层淡入**。以前会在换歌时把 stage.alpha 压到 0 再花 220ms 推回 1，代价是
     * 只要调用方多换几次歌（播放页重算 theme、切字幕开关都会让 song 对象换个引用），画面就永远
     * 停在 alpha≈0 的那一帧 —— 看起来就是「选了提示词，只有背景，什么都没有」。框自己每一句都
     * 有进场，硬切一次比看不见好。
     */
    swapSong(song: PromptSongContext) {
        if (this.destroyed) return;
        const sameProgram = song.boxes === this.options.song.boxes;
        this.options.song = song;
        if (sameProgram) {
            if (this.options.paused) this.renderOnce();
            return;
        }
        this.clearBoxes();
        this.stage.alpha = 1;
        if (this.options.paused) this.renderOnce();
    }

    setPaused(paused: boolean) {
        if (this.destroyed) return;
        this.options.paused = paused;
        if (paused) {
            this.app.stop();
            this.renderOnce();
        } else {
            this.app.start();
        }
    }

    renderOnce() {
        if (this.destroyed) return;
        this.renderFrame();
        this.app.renderer.render(this.app.stage);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.app.stop();
        this.app.ticker.remove(this.renderFrame);
        this.clearBoxes();
        this.app.destroy({ removeView: true }, { children: true, texture: true });
    }
}
