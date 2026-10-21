import type { MotionValue } from 'framer-motion';
import type { Theme } from '../../../types';
import { loadPixi } from '../pixi/loadPixi';
import { makePixiContext } from '../pixi/pixiWebGLContext';
import { linkPixiPrograms } from '../pixi/pixiProgramLinks';
import {
    buildPromptPanel,
    PROMPT_MONO_STACK,
    PROMPT_PALETTE,
    type PromptPanelView,
} from './promptBox';
import type { PromptBoxPlan } from './promptProgram';
import { samplePromptTerms } from './promptTerms';

// src/components/visualizer/prompt/createPromptPixiRuntime.ts
// 「提示词」样式自己的 Pixi 运行时。它不认商籁那套节目单（场景 / 镜头 / 排版），只做四件事：
//
//   1. 收下 promptProgram 编译好的节目单（一句一个框）；
//   2. 按播放时间挑出此刻该在台上的那一句：上方一块概率面板，下方一张歌词窗（字是发光的）；
//   3. 每个词一个 pixi.Text，唱到才落下；正在唱的换成主题强调色，其余用主题字色；
//   4. 一句之内镜头持续推近，并跟着唱到的字平移；退场时抽回去。
//
// 形态是精简的悬浮窗（上面概率面板、下面歌词窗），不用出血大字，所以镜头幅度克制：
// 推近到 1.2 倍、横移只补一部分（FOLLOW），整块界面不会被拖出画面。
//
// 坐标：**画面 px**。运行时不再把整层缩放（那是「面板里 9px 的 token id 落到屏上只剩 4px」
// 的根源），root 只负责摆到画面中心；camera 是镜头：面板与歌词窗跟着一起推近、一起横移。
type PixiModule = typeof import('pixi.js');

/** 量宽用的参考字号：先按 100 量出整行宽，再反解出真正要用的字号。 */
const FONT_BASE = 100;
/** 词间距占字号的比例。 */
const WORD_GAP_RATIO = 0.34;
/**
 * 歌词窗左右各留多少（占面板宽的比例）。整行宽度 = 面板宽 - 2×这个值，所以字永远装得进窗。
 */
const CARD_PAD_RATIO = 0.03;
/** 字号上限（占屏高）：短句（一个词那种）不至于把整屏塞满。 */
const FONT_MAX_RATIO = 0.14;
/** 一句之内镜头再推近多少（0.2 = 收尾时整块界面放到 1.2 倍）。 */
const DOLLY_PUSH = 0.2;
/** 推近的同时跟着唱到的字横移多少：1 = 完全钉住，太大整块窗会被拖出画面。 */
const FOLLOW = 0.9;
/** 一个词从「没出现」到「全亮」用多久。 */
const WORD_REVEAL_S = 0.09;

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
    /** 减少动感：框不飞、镜头不推，只按时间显隐。 */
    staticMode: boolean;
    signal?: AbortSignal;
}

/** 一个词在行里的位置（px）与它被唱到的窗口。 */
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
    /** 镜头：只装大字（面板是 HUD，不跟着推拉）。 */
    camera: import('pixi.js').Container;
    panel: PromptPanelView;
    wordLayer: import('pixi.js').Container;
    words: BuiltWord[];
    caret: import('pixi.js').Graphics;
    tokens: WordBox[];
    /** 这一句大字的字号（px）。 */
    fontPx: number;
    /** 这一行大字的总宽（px）：镜头要不要平移、平移多少按它算。 */
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
        // 框是自己画墨底的，画布本身要透明（底下是 VisualizerShell 的背景）。
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
            // 巨大的字是带发光的，按设备像素比走就够了。
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
        // 面板宽、字号、大字都按屏宽解，尺寸一变就得重搭。
        this.clearBoxes();
        return true;
    }

    private clearBoxes() {
        this.boxes.forEach(box => this.destroyBox(box));
        this.boxes.clear();
    }

    private destroyBox(box: BuiltBox) {
        this.stage.removeChild(box.root);
        box.panel.root.destroy({ children: true });
        box.words.forEach(word => word.node.destroy());
        box.caret.destroy();
        box.wordLayer.destroy({ children: false });
        box.camera.destroy({ children: false });
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

    /** 面板宽（px）：歌词窗按它对齐，两个窗一样宽。 */
    private panelWidth() {
        return clamp(this.lastWidth * 0.86, 240, 760);
    }

    /**
     * 把一句歌词量出来：先按 FONT_BASE 量逐词宽度，再反解出「整行正好装进歌词窗」的字号。
     * 字号同时受屏高限制 —— 短句（一个词）会把字放到很大，不压一下会把整个窗撑到屏外。
     */
    private layoutRow(plan: PromptBoxPlan) {
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
         * undefined，(字数-1) * undefined = NaN，量出来的宽度就是 NaN，整行字与面板一起消失。
         */
        const measure = (text: string): number => {
            try {
                const width = metricsApi?.measureText(text, measureStyle).width;
                return Number.isFinite(width) && width > 0 ? width : text.length * FONT_BASE * 0.62;
            } catch {
                return text.length * FONT_BASE * 0.62;
            }
        };
        const baseWidths = plan.words.map(word => measure(word.text));
        const baseRow = baseWidths.reduce((sum, width) => sum + width, 0)
            + FONT_BASE * WORD_GAP_RATIO * Math.max(0, baseWidths.length - 1);
        // 窗内可用宽 = 面板宽 - 左右留白；整行必须装进去（这就是「没有出血、不需要镜头」的前提）。
        const available = this.panelWidth() * (1 - CARD_PAD_RATIO * 2);
        const byWidth = baseRow > 0 ? FONT_BASE * (available / baseRow) : FONT_BASE;
        const fontPx = clamp(Math.min(byWidth, Math.max(240, this.lastHeight) * FONT_MAX_RATIO), 12, 420);

        const scale = fontPx / FONT_BASE;
        const gap = fontPx * WORD_GAP_RATIO;
        const widths = baseWidths.map(width => width * scale);
        const rowWidth = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
        // 词从「整行居中」的位置往右排：大字层与面板都以 0 为中心。
        const tokens: WordBox[] = [];
        let cursor = -rowWidth / 2;
        widths.forEach((width, index) => {
            tokens.push({
                text: plan.words[index].text,
                left: cursor,
                width,
                startTime: plan.words[index].startTime,
                endTime: plan.words[index].endTime,
            });
            cursor += width + gap;
        });
        return { tokens, rowWidth, fontPx };
    }

    /** 本首主题自己的高亮词：云端那批词拿不到时，细带用它们补位。 */
    private ownWords(): string[] {
        return (this.options.song.theme?.wordColors ?? [])
            .map(entry => String(entry?.word ?? '').trim())
            .filter(word => word.length > 0);
    }

    /** 词 → 高亮色。整行同色会很花，所以只给「被 AI 标过的词」备一份。 */
    private highlighter() {
        const byWord = new Map<string, number>();
        (this.options.song.theme?.wordColors ?? []).forEach(entry => {
            const word = String(entry?.word ?? '').trim();
            if (!word) return;
            const color = themeColor(this.pixi, entry?.color, PROMPT_PALETTE.bone, 0.55);
            byWord.set(word, color);
        });
        return (text: string): number | null => byWord.get(text.trim()) ?? null;
    }

    private buildBox(plan: PromptBoxPlan): BuiltBox {
        const { Container, Graphics, Text, TextStyle } = this.pixi;
        const { tokens, fontPx, rowWidth } = this.layoutRow(plan);
        const colors = this.palette();
        // 两张卡共同的底：比纯黑轻一点，压在亮背景上也看得出边界。
        const cardInk = this.pixi.Color.shared.setValue(PROMPT_PALETTE.ink).toNumber();
        const height = Math.max(240, this.lastHeight);

        const root = new Container();
        root.position.set(this.lastWidth / 2, height / 2);
        // 面板与歌词窗都装在 camera 里：推近、跟着唱到的字平移，都是一次镜头运动。
        const camera = new Container();
        root.addChild(camera);

        const panelWidth = this.panelWidth();
        const panel = buildPromptPanel(this.pixi, {
            width: panelWidth,
            centerY: -height * 0.10,
            accent: colors.accent,
            textColor: colors.text,
            seed: plan.termSeed,
            endTime: plan.endTime,
            terms: samplePromptTerms(this.ownWords(), plan.termSeed, 5),
            tokens: tokens.map(token => ({ text: token.text, startTime: token.startTime, endTime: token.endTime })),
        });
        camera.addChild(panel.root);

        /*
         * 大字：字宽用白的，颜色交给 tint —— 主题色、AI 高亮色都只是换个 tint，不用重烤纹理。
         * 发光用 dropShadow（canvas 的 shadowBlur，烤进同一张纹理）：distance 0 就是一圈光晕，
         * 比复制一层字加 BlurFilter 便宜得多。padding 是给光晕留的地方，不然光晕会被纹理边缘切齐；
         * 留了 padding 字形会往内缩 padding，所以每个字往左补回去。
         */
        const wordPad = Math.round(clamp(fontPx * 0.09, 6, 40));
        const wordStyle = new TextStyle({
            fontFamily: PROMPT_MONO_STACK,
            fontWeight: '600',
            fontSize: fontPx,
            fill: '#ffffff',
            padding: wordPad,
            dropShadow: {
                color: '#ffffff',
                alpha: 0.72,
                blur: Math.max(6, fontPx * 0.06),
                distance: 0,
                angle: 0,
            },
        });

        const highlightOf = this.highlighter();
        const words: BuiltWord[] = tokens.map(token => {
            /*
             * resolution 1：这句字大到一两百 px，按设备像素比（2）烤纹理一张就是好几兆，
             * 一句六七个词直接上十几 MB。字本身带发光，1 倍像素看不出软。
             */
            const node = new Text({ text: token.text, style: wordStyle, resolution: 1 });
            node.anchor.set(0, 0.5);
            node.position.set(token.left - wordPad, 0);
            node.visible = false;
            return { node, box: token, color: highlightOf(token.text) };
        });
        /*
         * 歌词那张窗：一块更薄的墨底 + 一圈细线，宽度只包住这一行字（最多和面板一样宽）。
         * 精简的悬浮窗就该「贴着内容长」，不是一块固定大小的黑板。
         */
        const cardPadX = panelWidth * CARD_PAD_RATIO;
        const cardWidth = Math.min(panelWidth, rowWidth + cardPadX * 2);
        const cardHeight = fontPx * 1.12 + fontPx * 0.34;
        const radius = Math.round(clamp(fontPx * 0.14, 8, 24));

        /*
         * 竖着摆：歌词窗挂在面板下沿，间距固定 —— 短句的字会更大、窗也更高，
         * 按「屏高的百分比」摆就会和面板叠在一起（一个大字句能长到 500px 高）。
         */
        const cardY = panel.centerY + panel.height / 2 + height * 0.025 + cardHeight / 2;
        const wordLayer = new Container();
        wordLayer.position.set(0, cardY);

        const card = new Graphics()
            .roundRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, radius)
            .fill({ color: cardInk, alpha: 0.72 })
            .stroke({ color: colors.text, width: 1, alpha: 0.15 });
        wordLayer.addChild(card);
        words.forEach(word => wordLayer.addChild(word.node));

        const caret = new Graphics()
            .rect(0, 0, Math.max(2, fontPx * 0.045), fontPx * 0.82)
            .fill({ color: colors.accent, alpha: 1 });
        caret.pivot.set(0, fontPx * 0.41);
        caret.alpha = 0;
        wordLayer.addChild(caret);

        camera.addChild(wordLayer);
        this.stage.addChild(root);
        return {
            root,
            camera,
            panel,
            wordLayer,
            words,
            caret,
            tokens,
            fontPx,
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
        const built = this.buildBox(plan);
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

    /** 镜头的姿势 + 词的落下与高亮。一个词的可见性只看播放时间，所以 seek 之后照样对得上。 */
    private updateBox(box: BuiltBox, time: number, staticMode: boolean) {
        const { startTime, endTime, tokens, fontPx } = box;
        // 帧值兜底：时间窗坏了（云端歌词偶尔会有缺 endTime 的行）会算出 NaN，
        // 而 alpha 一旦是 NaN，root.visible 就永远为 false —— 空屏，且没有任何报错。
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
        let landed = 0;
        let lastLandedAge = Infinity;
        let activeToken = -1;
        tokens.forEach((token, index) => {
            if (token.startTime > time) return;
            caretX = token.left + token.width * progressOf(time, token.startTime, token.endTime);
            landed += 1;
            lastLandedAge = Math.min(lastLandedAge, time - token.startTime);
            if (time <= token.endTime + 0.1) activeToken = index;
        });
        const firstStart = tokens[0]?.startTime ?? startTime;
        const lastStart = tokens[tokens.length - 1]?.startTime ?? firstStart;
        // 唱到几成：这一句的第一个字开唱 → 最后一个字开唱。镜头推近的进度靠它。
        const sung = clamp01(progressOf(time, firstStart, lastStart + 1e-3));

        /*
         * ---- 镜头
         * 面板与歌词窗一起推：进场从 0.94 推到 1，一句之内再缓慢推到 1.2，退场抽回 0.84；
         * 推近的同时跟着唱到的字横移（被唱的那个词留在原地，其余从它两边流过去）。
         */
        if (staticMode) {
            box.camera.position.set(0, 0);
            box.camera.scale.set(1);
            box.camera.rotation = 0;
            box.camera.alpha = time >= firstStart - 0.2 ? 1 : 0;
            box.panel.root.alpha = 1;
        } else {
            // 落下一个词时镜头轻微一顿，像跟焦追上去了。
            const punch = landed > 0 && Number.isFinite(lastLandedAge)
                ? Math.max(0, 1 - lastLandedAge / 0.22)
                : 0;
            const dolly = (0.94 + 0.06 * enter)
                * (1 + DOLLY_PUSH * sung * sung)
                * (1 - 0.30 * exit)
                + punch * 0.02;
            const follow = -caretX * (dolly - 1) * FOLLOW;
            box.camera.position.set(
                safe(follow, 0),
                safe((1 - enter) * this.lastHeight * 0.05 - exit * this.lastHeight * 0.07, 0),
            );
            box.camera.scale.set(safe(dolly, 1));
            box.camera.rotation = 0;
            box.camera.alpha = safe(alpha, 0);
            box.panel.root.alpha = 1;
        }
        box.root.visible = box.camera.alpha > 0.004;

        /*
         * 大字：唱到才落下；**唱过的高亮色留着不还回去** —— 一句唱完，整行都是亮的，
         * 像逐字填色那样留下唱过的痕迹。AI 标过色的词用它自己的色，其余用主题强调色。
         */
        const colors = this.palette();
        box.words.forEach((word, index) => {
            const appear = clamp01((time - word.box.startTime) / WORD_REVEAL_S);
            word.node.visible = appear > 0;
            if (!word.node.visible) return;
            word.node.alpha = appear;
            word.node.y = (1 - appear) * fontPx * 0.16;
            const sungThrough = time >= word.box.startTime;
            const tint = sungThrough ? (word.color ?? colors.accent) : colors.text;
            if (word.node.tint !== tint) word.node.tint = tint;
        });

        // 光标：唱到哪儿跟到哪儿；句尾之后先亮半秒再闪，别跟着最后一个词一起瞬间消失。
        const blinkOn = time - lastStart < 0.5 || Math.floor(time * 1.6) % 2 === 1;
        box.caret.x = caretX + fontPx * 0.06;
        box.caret.alpha = blinkOn ? 1 : 0.12;

        box.panel.update(time, activeToken, 1);
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
        // 上一句还在演它的退场（整场在句尾被抽走），所以两块一起驱动；它们各自按绝对时间算姿势。
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
     * 有飞入，硬切一次比看不见好。
     *
     * 节目单没变（同一个数组）就只换主题：颜色是 tint、下一次搭框就换上，已搭的框不用重搭。
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
