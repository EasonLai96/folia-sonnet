import type { MotionValue } from 'framer-motion';
import type { Theme } from '../../../types';
import { loadPixi } from '../pixi/loadPixi';
import { makePixiContext } from '../pixi/pixiWebGLContext';
import { linkPixiPrograms } from '../pixi/pixiProgramLinks';
import {
    buildPromptBox,
    PROMPT_MONO_STACK,
    PROMPT_PALETTE,
    promptFieldMetrics,
    type PromptBoxToken,
    type PromptBoxView,
} from './promptBox';
import type { PromptBoxPlan } from './promptProgram';
import { samplePromptTerms } from './promptTerms';

// src/components/visualizer/prompt/createPromptPixiRuntime.ts
// 「提示词」样式自己的 Pixi 运行时。它不认商籁那套节目单（场景 / 镜头 / 排版），只做三件事：
//
//   1. 收下 promptProgram 编译好的节目单（一句一个框）；
//   2. 按播放时间挑出此刻该在台上的那一句，把框和它的前一句一起交给 promptBox 逐帧摆姿势；
//   3. 每个词一个 pixi.Text：唱到才落下，正在唱且被 AI 标了高亮色就换成高亮色。
//
// 框的几何与动画全在 promptBox.ts，这里只管生命周期、缓存、换歌和每帧调度。
type PixiModule = typeof import('pixi.js');

/** 字宽/字高都以它为单位量，最后整框缩放到屏上 —— 一句话的字号是「解」出来的，不是设的。 */
const FONT_BASE = 100;
/** 词间距（自然单位）。 */
const WORD_GAP = FONT_BASE * 0.34;
/** 解出来的缩放夹在两头：太小的屏也别把字缩成一条线。 */
const MIN_SCALE = 0.02;
const MAX_SCALE = 2.4;
/** 一个词从「没出现」到「全亮」用多久。 */
const WORD_REVEAL_S = 0.09;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clamp01 = (value: number) => clamp(value, 0, 1);

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
    /** 减少动感：框不飞，只按时间显隐。 */
    staticMode: boolean;
    signal?: AbortSignal;
}

interface BuiltWord {
    node: import('pixi.js').Text;
    token: PromptBoxToken;
    /** AI 给这个词标的颜色（没有就是 null）。 */
    color: number | null;
}

interface BuiltBox {
    root: import('pixi.js').Container;
    frame: import('pixi.js').Container;
    view: PromptBoxView;
    words: BuiltWord[];
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
            // 没有滤镜、没有离屏目标，画布按设备像素比走就够了。
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
        // 框是按屏宽解字号的，尺寸一变就得重搭。
        this.clearBoxes();
        return true;
    }

    private clearBoxes() {
        this.boxes.forEach(box => this.destroyBox(box));
        this.boxes.clear();
    }

    private destroyBox(box: BuiltBox) {
        this.stage.removeChild(box.root);
        // 逐节点销毁：destroy({children:true}) 会留下每个 Graphics 自建的 GraphicsContext。
        box.view.behind.destroy({ children: true });
        box.view.front.destroy({ children: true });
        box.words.forEach(word => word.node.destroy());
        box.frame.destroy({ children: false });
        box.root.destroy({ children: false });
    }

    /** 把一句歌词量出来：逐词宽度 → 整行宽 → 反解出「刚好装进屏宽」的缩放。 */
    private layoutRow(plan: PromptBoxPlan) {
        const { TextStyle } = this.pixi;
        const styleOptions = {
            fontFamily: PROMPT_MONO_STACK,
            fontWeight: '500',
            fontSize: FONT_BASE,
            fill: PROMPT_PALETTE.bone,
        } as const;
        /*
         * 量宽必须拿**真的 TextStyle 实例**。CanvasTextMetrics.measureText 是从 style 上读
         * `letterSpacing` / `_fontString` / `styleKey` 的：给一个普通对象，letterSpacing 是
         * undefined，(字数-1) * undefined = NaN，量出来的宽度就是 NaN。而 NaN 会顺着
         * rowWidth → 框宽 → 每个 token 的 left → 字/括号/光标/底板一路传下去：
         * 除了不依赖行宽的铁栅栏，**整块框都画不出来**，看着就像「只显示了栅栏」。
         */
        const measureStyle = new TextStyle(styleOptions);
        const metricsApi = (this.pixi as unknown as {
            CanvasTextMetrics?: { measureText: (text: string, style: unknown) => { width: number } };
        }).CanvasTextMetrics;
        const measure = (text: string): number => {
            try {
                const width = metricsApi?.measureText(text, measureStyle).width;
                // NaN/0 一律按字数估：宁可字宽估歪，也不能让整块框消失。
                return Number.isFinite(width) && width > 0 ? width : text.length * FONT_BASE * 0.62;
            } catch {
                return text.length * FONT_BASE * 0.62;
            }
        };
        const widths = plan.words.map(word => measure(word.text));
        const rowWidth = widths.reduce((sum, width) => sum + width, 0) + WORD_GAP * Math.max(0, widths.length - 1);
        const field = promptFieldMetrics(rowWidth, FONT_BASE);
        const areaWidth = Math.max(240, this.lastWidth * 0.88);
        // 屏高那一头按「框高 = 字高 × 2.05」算，和 promptFieldMetrics 一致。
        const areaHeight = Math.max(180, this.lastHeight * 0.62);
        const solved = Math.min(areaWidth / field.width, areaHeight / field.height);
        // 量不出宽度（字体没就绪）时会算出 NaN/0：整框 scale 一旦是 NaN，画面就是一片空。
        const scale = Number.isFinite(solved) && solved > 0
            ? clamp(solved, MIN_SCALE, MAX_SCALE)
            : 1;
        // 词从「整行居中」的位置往右排：promptBox 的框是以 0 为中心的，框里的字必须也以 0 为中心。
        const tokens: PromptBoxToken[] = [];
        let cursor = -rowWidth / 2;
        widths.forEach((width, index) => {
            tokens.push({
                left: cursor,
                width,
                startTime: plan.words[index].startTime,
                endTime: plan.words[index].endTime,
            });
            cursor += width + WORD_GAP;
        });
        return { tokens, rowWidth, scale, styleOptions };
    }

    /** 本首主题自己的高亮词：框上那行提示词优先从这几个里取。 */
    private ownWords(): string[] {
        return (this.options.song.theme.wordColors ?? [])
            .map(entry => String(entry.word ?? '').trim())
            .filter(word => word.length > 0);
    }

    private highlighter() {
        const byWord = new Map<string, number>();
        (this.options.song.theme.wordColors ?? []).forEach(entry => {
            const word = String(entry.word ?? '').trim();
            if (!word) return;
            const color = entry.color;
            if (typeof color !== 'string' || !color) return;
            try {
                byWord.set(word, this.pixi.Color.shared.setValue(color).toNumber());
            } catch {
                // 云端推来的颜色不可信，坏值当没有。
            }
        });
        return (text: string): number | null => byWord.get(text.trim()) ?? null;
    }

    private buildBox(plan: PromptBoxPlan): BuiltBox {
        const { Container, Text } = this.pixi;
        const { tokens, rowWidth, scale, styleOptions } = this.layoutRow(plan);
        const root = new Container();
        root.position.set(this.lastWidth / 2, this.lastHeight / 2);
        root.scale.set(scale);
        const frame = new Container();
        root.addChild(frame);

        const view = buildPromptBox(this.pixi, {
            tokens,
            rowWidth,
            rowHeight: FONT_BASE,
            startTime: plan.startTime,
            endTime: plan.endTime,
            terms: samplePromptTerms(this.ownWords(), plan.termSeed, 5),
            // 整框已经按 scale 缩过，框内部一律用自然单位画。
            uiScale: 1,
            // 铁栅栏要铺满整屏：按「缩放前的屏」算，缩完正好回到屏上。
            width: this.lastWidth / scale,
            height: this.lastHeight / scale,
            withBars: plan.withBars,
        });

        const highlightOf = this.highlighter();
        const words: BuiltWord[] = plan.words.map((word, wordIndex) => {
            // Text 自己会把这份描述包成 TextStyle；每个词一份，免得共用一个实例互相改。
            const node = new Text({ text: word.text, style: { ...styleOptions } });
            node.anchor.set(0, 0.5);
            node.position.set(tokens[wordIndex].left, 0);
            node.visible = false;
            return { node, token: tokens[wordIndex], color: highlightOf(word.text) };
        });
        const textLayer = new Container();
        words.forEach(word => textLayer.addChild(word.node));

        frame.addChild(view.behind, textLayer, view.front);
        this.stage.addChild(root);
        return { root, frame, view, words };
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

    /** 框的姿势 + 词的落下与高亮。一个词的可见性只看播放时间，所以 seek 之后照样对得上。 */
    private updateBox(box: BuiltBox, time: number, staticMode: boolean) {
        const frame = box.view.update(time);
        // 帧值兜底：时间窗坏了（云端歌词偶尔会有缺 endTime 的行）会算出 NaN，
        // 而 alpha 一旦是 NaN，root.visible 就永远为 false —— 空屏，且没有任何报错。
        const safe = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
        const alpha = safe(frame.alpha, 0);
        if (staticMode) {
            const on = time >= box.view.tokens[0]?.startTime - 0.2;
            box.frame.position.set(0, 0);
            box.frame.scale.set(1);
            box.frame.rotation = 0;
            box.root.alpha = on ? 1 : 0;
        } else {
            box.frame.position.set(safe(frame.offsetX, 0), safe(frame.offsetY, 0));
            box.frame.scale.set(safe(frame.scale, 1));
            box.frame.rotation = safe(frame.rotation, 0);
            box.root.alpha = alpha;
        }
        box.root.visible = box.root.alpha > 0.004;

        box.words.forEach((word, index) => {
            const appear = clamp01((time - word.token.startTime) / WORD_REVEAL_S);
            word.node.visible = appear > 0;
            if (!word.node.visible) return;
            word.node.alpha = appear;
            word.node.y = (1 - appear) * FONT_BASE * 0.22;
            // 只有「正在唱」的那个词吃 AI 高亮色，唱过去就还原 —— 不然整行会花掉。
            const tint = index === frame.activeToken && word.color !== null ? word.color : 0xffffff;
            if (word.node.tint !== tint) word.node.tint = tint;
        });
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
        // 上一句还在演它的退场（框在句尾被抽走），所以两块一起驱动；它们各自按绝对时间算姿势。
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
     * 节目单没变（同一个数组）就只换主题：高亮色与提示词是搭框时读的，框不用重搭。
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
