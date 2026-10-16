import { DEFAULT_CADENZA_TUNING, DEFAULT_CAPPELLA_TUNING, DEFAULT_CLADDAGH_TUNING, DEFAULT_CLASSIC_TUNING, DEFAULT_DIORAMA_TUNING, DEFAULT_FUME_TUNING, DEFAULT_LATENT_BACKGROUND_TUNING, DEFAULT_LUMIERE_TUNING, DEFAULT_MONET_BACKGROUND_TUNING, DEFAULT_MONET_TUNING, DEFAULT_NOMAND_BACKGROUND_TUNING, DEFAULT_PARTITA_TUNING, DEFAULT_PENDOLO_TUNING, DEFAULT_SONNET_TUNING, DEFAULT_SORA_BACKGROUND_TUNING, DEFAULT_TEMPERA_LAYER_IMAGE, DEFAULT_TEMPERA_TUNING, DEFAULT_TILT_TUNING, DIORAMA_PARTICLE_DENSITY_MAX, DIORAMA_PARTICLE_DENSITY_MIN, DIORAMA_PARTICLE_GLOW_INTENSITY_MAX, DIORAMA_PARTICLE_GLOW_INTENSITY_MIN, DIORAMA_PARTICLE_SIZE_MAX, DIORAMA_PARTICLE_SIZE_MIN, SONNET_CAMERA_INTENSITY_MAX, TEMPERA_MAX_LAYER_IMAGES, type CadenzaTuning, type CappellaAvatarSource, type CappellaTuning, type ClassicTuning, type CladdaghTuning, type DioramaTuning, type FumeTuning, type LatentBackgroundColorSource, type LatentBackgroundDisplayMode, type LatentBackgroundTuning, type LumiereTuning, type MonetBackgroundLayout, type MonetBackgroundSource, type MonetBackgroundTuning, type MonetBackgroundWashColorMode, type MonetPortraitSource, type MonetTuning, type NomandBackgroundDitheringType, type NomandBackgroundEffect, type NomandBackgroundSource, type NomandBackgroundTuning, type PartitaTuning, type PendoloTuning, type SonnetTuning, type SoraBackgroundTuning, type TemperaLayerImage, type TemperaTuning, type TiltTuning, type UrlBackgroundItem, type VisualizerBackgroundMode, type VisualizerFrameRate, type VisualizerMode } from '../types';
// 只做字符串校验，走 types/visualizerModes 而不是 registry：后者的 eager glob 会把 13 个
// renderer（含 three.js）拉进来，而这里读的只是一个 localStorage 字符串。
// mod 模式在启动时本来就看不到——bootstrap.tsx 的 restoreStoredModVisualizer 在 mods 注册完
// 之后专门补一次，行为不变。
import {
    DEFAULT_VISUALIZER_BACKGROUND_MODE,
    DEFAULT_VISUALIZER_MODE,
    isBuiltinVisualizerBackgroundMode,
    isBuiltinVisualizerMode,
} from '../types/visualizerModes';
import { resolveDioramaMoteCircumference, resolveDioramaMoteRadial } from '../utils/visualizer/dioramaMoteTuning';
import { parseVisualizerFrameRate, VISUALIZER_FRAME_RATE_STORAGE_KEY } from '../utils/frameRateLimiter';
import { sanitizeUrlBackgroundList } from '../utils/urlBackground';
import { normalizeLumiereTuning } from '../utils/lumiereTuning';

export const VISUALIZER_OPACITY_STORAGE_KEY = 'visualizer_opacity';

// src/stores/visualizerSettingsPersistence.ts
// localStorage read/clamp/resolve helpers for every visualizer and background setting.
//
// Moved verbatim out of useSettingsUiStore so the visualizer domain can own its own store
// without either file importing the other. Storage keys and clamping behaviour are unchanged —
// this module is the persistence half of that domain, nothing more.

export const readStoredBackgroundOpacity = () => {
    if (typeof window === 'undefined') {
        return 0.75;
    }

    const saved = localStorage.getItem('background_opacity');
    const parsed = saved ? parseFloat(saved) : 0.75;
    return Number.isFinite(parsed) ? parsed : 0.75;
};

/** 可视化叠层（盖在壁纸之上那层 WebView）整体窗口的不透明度。 */
export const WALLPAPER_OVERLAY_OPACITY_STORAGE_KEY = 'folia.wallpaperOverlayOpacity';

export const readStoredWallpaperOverlayOpacity = () => {
    if (typeof window === 'undefined') {
        return 1;
    }
    const saved = localStorage.getItem(WALLPAPER_OVERLAY_OPACITY_STORAGE_KEY);
    const parsed = saved ? parseFloat(saved) : 1;
    // 下限给 0.1 而不是 0：0 等于整层看不见，用户会以为功能坏了。
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0.1, parsed)) : 1;
};

/**
 * 「精简」样式那颗悬浮歌词小窗的底色不透明度。
 *
 * 单独一份，不复用 `backgroundOpacity`（那是壁纸背景的）也不复用
 * `wallpaperOverlayOpacity`（那是跟随样式那层 WebView 叠层的）：
 * 小窗是**另一层窗口**，它的底色浓淡跟壁纸那头的观感完全无关，
 * 跟着壁纸那个滑条一起动只会让人两头都对不上。
 *
 * 缺省 0.62：两行字压在桌面上要看得清，但又不能糊住后面的图标。
 */
export const WALLPAPER_FLOATING_OPACITY_STORAGE_KEY = 'folia.wallpaperFloatingOpacity';

export const readStoredWallpaperFloatingOpacity = () => {
    if (typeof window === 'undefined') {
        return 0.62;
    }
    const saved = localStorage.getItem(WALLPAPER_FLOATING_OPACITY_STORAGE_KEY);
    const parsed = saved ? parseFloat(saved) : 0.62;
    /*
     * 下限是 **0**，不是 0.05。
     *
     * 原来卡在 0.05 是怕「一块看不见的窗口」让人以为功能坏了，但有人要的就是
     * **只有字、没有底** —— 尤其叠加在安全区上时，那一条本来就该融进状态栏，
     * 多一块底色反而突兀。想要底的人往上调就是了。
     */
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.62;
};

/**
 * 「精简」小窗是否直接叠在安全区（状态栏那一条）上面。默认关 ——
 * 开着会压住状态栏，那是用户主动选的，不该是默认值。
 */
export const WALLPAPER_FLOATING_OVER_SAFE_AREA_STORAGE_KEY = 'folia.wallpaperFloatingOverSafeArea';

export const readStoredWallpaperFloatingOverSafeArea = () => {
    if (typeof window === 'undefined') {
        return false;
    }
    return localStorage.getItem(WALLPAPER_FLOATING_OVER_SAFE_AREA_STORAGE_KEY) === 'true';
};

/**
 * 叠加安全区时小窗的左右位置（0 = 贴左，1 = 贴右）。默认 0.5 = 居中。
 *
 * 它只是**初值**：用户上手拖过之后原生那边记的是拖出来的比例，
 * 这里再改会覆盖回去（真正的「拖不动」只能靠设置里改这个值来修）。
 */
export const WALLPAPER_FLOATING_OFFSET_X_STORAGE_KEY = 'folia.wallpaperFloatingOffsetX';

export const readStoredWallpaperFloatingOffsetX = () => {
    if (typeof window === 'undefined') {
        return 0.5;
    }
    const saved = localStorage.getItem(WALLPAPER_FLOATING_OFFSET_X_STORAGE_KEY);
    const parsed = saved ? parseFloat(saved) : 0.5;
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.5;
};

/**
 * 叠加安全区时小窗占屏幕宽度的比例，默认 0.8。
 *
 * 它是**屏幕宽度的比例**而不是像素：这个模式要的是「占住状态栏这一条的多宽」，
 * 百分比比像素直观，换台设备也不会变样。下限 0.5 —— 再窄的话一行歌词基本每句
 * 都要靠横向滚动才看得完。
 */
export const WALLPAPER_FLOATING_WIDTH_STORAGE_KEY = 'folia.wallpaperFloatingWidth';

export const readStoredWallpaperFloatingWidth = () => {
    if (typeof window === 'undefined') {
        return 0.8;
    }
    const saved = localStorage.getItem(WALLPAPER_FLOATING_WIDTH_STORAGE_KEY);
    const parsed = saved ? parseFloat(saved) : 0.8;
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0.5, parsed)) : 0.8;
};

/**
 * 叠加安全区时是否**直接占满整条**（左右不再留空）。默认关 ——
 * 占满会压住整条状态栏，那是比「叠在安全区上」更进一步的选择。
 *
 * 非竖屏时原生那边不认这一条：横屏下状态栏那一条的意义完全不同，
 * 占满只会糊住一整条，所以自动退回宽度滑条给的宽。
 */
/**
 * 歌词字体的来路：'follow' = 跟随播放页那套，'custom' = 这两层单独指定一个字体文件。
 *
 * 默认 custom —— 老用户已经选过字体的，不该因为多了这个开关就悄悄失效。
 *
 * 为什么「跟随」在原生那两层上等于「用系统字体」：播放页的歌词字体是网页侧用
 * FontFace 注册的（文件存在 IndexedDB 里），原生拿不到那个字节，只能不覆盖、
 * 回落到系统 sans-serif。真正跟着播放页走的是 WebView 叠层那一层 ——
 * 它本来就是网页，用的就是主题里那个字体。
 */
export const WALLPAPER_LYRICS_FONT_MODE_STORAGE_KEY = 'folia.wallpaperLyricsFontMode';

export const readStoredWallpaperLyricsFontMode = (): 'follow' | 'custom' => {
    if (typeof window === 'undefined') {
        return 'custom';
    }
    return localStorage.getItem(WALLPAPER_LYRICS_FONT_MODE_STORAGE_KEY) === 'follow'
        ? 'follow'
        : 'custom';
};

export const WALLPAPER_FLOATING_FILL_SAFE_AREA_STORAGE_KEY = 'folia.wallpaperFloatingFillSafeArea';

export const readStoredWallpaperFloatingFillSafeArea = () => {
    if (typeof window === 'undefined') {
        return false;
    }
    return localStorage.getItem(WALLPAPER_FLOATING_FILL_SAFE_AREA_STORAGE_KEY) === 'true';
};

/**
 * 占满时留出的「避开区域」宽度（占整条宽的比例）。默认 0.12 ——
 * 一颗挖孔连着它周围那一圈差不多就是这个比例。0 = 不避让。
 */
export const WALLPAPER_FLOATING_AVOID_WIDTH_STORAGE_KEY = 'folia.wallpaperFloatingAvoidWidth';

export const readStoredWallpaperFloatingAvoidWidth = () => {
    if (typeof window === 'undefined') {
        return 0.12;
    }
    const saved = localStorage.getItem(WALLPAPER_FLOATING_AVOID_WIDTH_STORAGE_KEY);
    const parsed = saved ? parseFloat(saved) : 0.12;
    // 上限 0.5：划掉一半以上就没什么地方画字了。
    return Number.isFinite(parsed) ? Math.min(0.5, Math.max(0, parsed)) : 0.12;
};

/**
 * 避开区域的左右位置（0 = 贴左，1 = 贴右），默认 0.5 = 正中间
 * （挖孔绝大多数在正中）。
 */
export const WALLPAPER_FLOATING_AVOID_OFFSET_X_STORAGE_KEY = 'folia.wallpaperFloatingAvoidOffsetX';

export const readStoredWallpaperFloatingAvoidOffsetX = () => {
    if (typeof window === 'undefined') {
        return 0.5;
    }
    const saved = localStorage.getItem(WALLPAPER_FLOATING_AVOID_OFFSET_X_STORAGE_KEY);
    const parsed = saved ? parseFloat(saved) : 0.5;
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.5;
};

/**
 * 悬浮小窗的字号模式：'dynamic' = 跟着窗口高度算（拖大窗口字就跟着大），
 * 'custom' = 自己指定一个字号。
 *
 * 为什么要有 custom：叠加模式下窗口只有状态栏那么高，按高度算出来的字号小到看不清 ——
 * 那种情况必须能自己指定。
 */
export const WALLPAPER_FLOATING_FONT_SIZE_MODE_STORAGE_KEY = 'folia.wallpaperFloatingFontSizeMode';

export const readStoredWallpaperFloatingFontSizeMode = (): 'dynamic' | 'custom' => {
    if (typeof window === 'undefined') {
        return 'dynamic';
    }
    return localStorage.getItem(WALLPAPER_FLOATING_FONT_SIZE_MODE_STORAGE_KEY) === 'custom'
        ? 'custom'
        : 'dynamic';
};

/** 自定义模式的字号（dp）。默认 14 —— 一行歌词挂在小窗里这个大小看着最舒服。 */
export const WALLPAPER_FLOATING_FONT_SIZE_STORAGE_KEY = 'folia.wallpaperFloatingFontSize';

export const readStoredWallpaperFloatingFontSize = () => {
    if (typeof window === 'undefined') {
        return 14;
    }
    const saved = localStorage.getItem(WALLPAPER_FLOATING_FONT_SIZE_STORAGE_KEY);
    const parsed = saved ? parseFloat(saved) : 14;
    // 10~32dp：再小看不清，再大一行就装不下了。
    return Number.isFinite(parsed) ? Math.min(32, Math.max(10, parsed)) : 14;
};

/**
 * 叠层总开关。
 *
 * 关掉之后一层都不挂（原生那层歌词照旧）。它同时也是「叠层由应用进程托管」的开关 ——
 * 打开时不再要求系统的动态壁纸是我们，没设壁纸也能在桌面/锁屏上挂这一层。
 */
export const WALLPAPER_OVERLAY_ENABLED_STORAGE_KEY = 'folia.wallpaperOverlayEnabled';

export const readStoredWallpaperOverlayEnabled = () => {
    if (typeof window === 'undefined') {
        return true;
    }
    // 没写过这个 key 的老用户按「开」处理：叠层本来就是默认在用的功能。
    return localStorage.getItem(WALLPAPER_OVERLAY_ENABLED_STORAGE_KEY) !== 'false';
};

/** 音乐锁屏：锁屏界面上也挂叠层。默认关 —— 锁屏上多一层东西要先由用户点头。 */
export const WALLPAPER_OVERLAY_LOCK_SCREEN_STORAGE_KEY = 'folia.wallpaperOverlayLockScreen';

export const readStoredWallpaperOverlayLockScreen = () =>
    typeof window !== 'undefined'
    && localStorage.getItem(WALLPAPER_OVERLAY_LOCK_SCREEN_STORAGE_KEY) === 'true';

/**
 * 叠层只在锁屏上出现：桌面、所有应用、App 内一律不挂。
 *
 * 默认关 —— 大多数人是冲着「桌面歌词」开的叠层，只有想要"锁屏才出现"的人才会来拨它。
 */
export const WALLPAPER_OVERLAY_LOCK_SCREEN_ONLY_STORAGE_KEY = 'folia.wallpaperOverlayLockScreenOnly';

export const readStoredWallpaperOverlayLockScreenOnly = () =>
    typeof window !== 'undefined'
    && localStorage.getItem(WALLPAPER_OVERLAY_LOCK_SCREEN_ONLY_STORAGE_KEY) === 'true';

/** 叠层是否在所有应用之上显示。默认只在桌面（壁纸可见）时挂着。 */
export const WALLPAPER_OVERLAY_ALL_APPS_STORAGE_KEY = 'folia.wallpaperOverlayAllApps';

export const readStoredWallpaperOverlayAllApps = () =>
    typeof window !== 'undefined'
    && localStorage.getItem(WALLPAPER_OVERLAY_ALL_APPS_STORAGE_KEY) === 'true';

/**
 * 跟随模式下是否隐藏原生那层歌词。
 *
 * 叠层跑的是播放页同一套可视化，它自己会画歌词；原生 GLES 那层如果照旧画，
 * 两层歌词会叠在一起。默认「跟随 + 叠层可用」时把原生那层关掉更干净，
 * 但留成开关 —— 有些模式的可视化歌词位置和原生不同，用户可能想两层都要。
 */
export const WALLPAPER_OVERLAY_HIDE_NATIVE_LYRICS_STORAGE_KEY = 'folia.wallpaperOverlayHideNativeLyrics';

export const readStoredWallpaperOverlayHideNativeLyrics = () =>
    typeof window !== 'undefined'
    && localStorage.getItem(WALLPAPER_OVERLAY_HIDE_NATIVE_LYRICS_STORAGE_KEY) === 'true';

/**
 * 桌面叠层里要不要显示封面。
 *
 * 默认**隐藏**：叠层是浮在原生壁纸之上的一层，而封面是一整块不透明的方形图，
 * 画上去就是把壁纸糊掉一大块 —— 叠层存在的意义恰恰是透出壁纸。
 * 在此之前封面根本没推给叠层页面（那里只有一层半透明底板），
 * 现在链路修好了，想要完整构图的人可以按这个开关打开。
 */
export const WALLPAPER_OVERLAY_HIDE_COVER_ART_STORAGE_KEY = 'folia.wallpaperOverlayHideCoverArt';

export const readStoredWallpaperOverlayHideCoverArt = () =>
    typeof window === 'undefined'
    || localStorage.getItem(WALLPAPER_OVERLAY_HIDE_COVER_ART_STORAGE_KEY) !== 'false';

/**
 * 纯音乐（没有歌词）时是否不显示叠层。
 *
 * 纯音乐下可视化只能画背景，画不出歌词；有人要的就是这时候干净点，
 * 也有人想留着动效当氛围，所以做成开关，默认开。
 */
/**
 * 歌词唱完之后（尾奏很长 / 后半段是纯音乐）是否自动隐藏叠层。
 *
 * 有些曲目只在前半段有几句歌词，后面几分钟没有 —— 那时候叠层只是挂着一片空白。
 * 默认开：最后一句唱完 3 秒后收起，跳回有歌词的位置再自动回来。
 */
export const WALLPAPER_OVERLAY_HIDE_AFTER_LYRICS_END_STORAGE_KEY = 'folia.wallpaperOverlayHideAfterLyricsEnd';

export const readStoredWallpaperOverlayHideAfterLyricsEnd = () =>
    typeof window === 'undefined'
    || localStorage.getItem(WALLPAPER_OVERLAY_HIDE_AFTER_LYRICS_END_STORAGE_KEY) !== 'false';

export const WALLPAPER_OVERLAY_SKIP_INSTRUMENTAL_STORAGE_KEY = 'folia.wallpaperOverlaySkipInstrumental';

/**
 * 暂停时是否自动隐藏叠层。
 *
 * 暂停时画面是静止的，叠层继续挂着只是白占一层窗口（还持续跑 rAF）。
 * 默认开：暂停就收起，恢复播放再自动回来。
 */
export const WALLPAPER_OVERLAY_HIDE_WHEN_PAUSED_STORAGE_KEY = 'folia.wallpaperOverlayHideWhenPaused';

export const readStoredWallpaperOverlayHideWhenPaused = () =>
    typeof window === 'undefined'
    || localStorage.getItem(WALLPAPER_OVERLAY_HIDE_WHEN_PAUSED_STORAGE_KEY) !== 'false';

export const readStoredWallpaperOverlaySkipInstrumental = () =>
    typeof window === 'undefined'
    || localStorage.getItem(WALLPAPER_OVERLAY_SKIP_INSTRUMENTAL_STORAGE_KEY) !== 'false';

/** 跟随模式下是否隐藏原生那层的进度条（叠层里可视化自带的那条不受影响）。 */
export const WALLPAPER_OVERLAY_HIDE_NATIVE_PROGRESS_STORAGE_KEY = 'folia.wallpaperOverlayHideNativeProgress';

export const readStoredWallpaperOverlayHideNativeProgress = () =>
    typeof window !== 'undefined'
    && localStorage.getItem(WALLPAPER_OVERLAY_HIDE_NATIVE_PROGRESS_STORAGE_KEY) === 'true';

export const readStoredVisualizerOpacity = () => {
    if (typeof window === 'undefined') {
        return 1;
    }

    const saved = localStorage.getItem(VISUALIZER_OPACITY_STORAGE_KEY);
    const parsed = saved ? parseFloat(saved) : 1;
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0.2, parsed)) : 1;
};

export const readStoredVisualizerMode = (): VisualizerMode => {
    if (typeof window === 'undefined') {
        return DEFAULT_VISUALIZER_MODE;
    }

    const saved = localStorage.getItem('visualizer_mode');
    if (saved === 'cadenza' || saved === 'cadenze') {
        return 'cadenza';
    }

    return isBuiltinVisualizerMode(saved) ? saved : DEFAULT_VISUALIZER_MODE;
};

export const readStoredVisualizerFrameRate = (): VisualizerFrameRate => {
    if (typeof window === 'undefined') {
        return 'off';
    }

    return parseVisualizerFrameRate(localStorage.getItem(VISUALIZER_FRAME_RATE_STORAGE_KEY));
};

export const clampClassicBreathingFloatMultiplier = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(2, Math.max(0, value));
};

export const clampClassicWordSpacing = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(2, Math.max(0, value));
};

export const readStoredClassicTuning = (): ClassicTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_CLASSIC_TUNING;
    }

    const saved = localStorage.getItem('classic_tuning');
    if (!saved) return DEFAULT_CLASSIC_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<ClassicTuning>;
        return {
            enableWordRotation: parsed.enableWordRotation ?? DEFAULT_CLASSIC_TUNING.enableWordRotation,
            breathingFloatMultiplier: clampClassicBreathingFloatMultiplier(
                parsed.breathingFloatMultiplier ?? DEFAULT_CLASSIC_TUNING.breathingFloatMultiplier,
                DEFAULT_CLASSIC_TUNING.breathingFloatMultiplier,
            ),
            useLegacyLayout: parsed.useLegacyLayout ?? DEFAULT_CLASSIC_TUNING.useLegacyLayout,
            wordSpacing: clampClassicWordSpacing(
                parsed.wordSpacing ?? DEFAULT_CLASSIC_TUNING.wordSpacing ?? 0.7,
                DEFAULT_CLASSIC_TUNING.wordSpacing ?? 0.7,
            ),
        };
    } catch {
        return DEFAULT_CLASSIC_TUNING;
    }
};

export const readStoredCadenzaTuning = (): CadenzaTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_CADENZA_TUNING;
    }

    const saved = localStorage.getItem('cadenza_tuning') ?? localStorage.getItem('cadenze_tuning');
    if (!saved) return DEFAULT_CADENZA_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<CadenzaTuning>;
        return {
            ...DEFAULT_CADENZA_TUNING,
            ...parsed,
            beamIntensity: 0,
        };
    } catch {
        return DEFAULT_CADENZA_TUNING;
    }
};

export const clampPartitaStagger = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(180, Math.max(0, value));
};

export const readStoredPartitaTuning = (): PartitaTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_PARTITA_TUNING;
    }

    const saved = localStorage.getItem('partita_tuning');
    if (!saved) return DEFAULT_PARTITA_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<PartitaTuning>;
        const rawMin = clampPartitaStagger(parsed.staggerMin ?? DEFAULT_PARTITA_TUNING.staggerMin, DEFAULT_PARTITA_TUNING.staggerMin);
        const rawMax = clampPartitaStagger(parsed.staggerMax ?? DEFAULT_PARTITA_TUNING.staggerMax, DEFAULT_PARTITA_TUNING.staggerMax);

        return {
            showGuideLines: parsed.showGuideLines ?? DEFAULT_PARTITA_TUNING.showGuideLines,
            useSemanticLayout: parsed.useSemanticLayout ?? DEFAULT_PARTITA_TUNING.useSemanticLayout,
            staggerMin: Math.min(rawMin, rawMax),
            staggerMax: Math.max(rawMin, rawMax),
        };
    } catch {
        return DEFAULT_PARTITA_TUNING;
    }
};

export const clampFumeCameraSpeed = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.85, Math.max(0.55, value));
};

export const clampFumeGlowIntensity = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.8, Math.max(0, value));
};

export const clampFumeBackgroundObjectOpacity = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1, Math.max(0, value));
};

export const clampFumeHeroScale = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.32, Math.max(0.82, value));
};

export const clampFumeTextHoldRatio = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1, Math.max(0, value));
};

export const resolveFumeCameraTrackingMode = (value: FumeTuning['cameraTrackingMode'] | undefined) => (
    value === 'stepped' || value === 'smooth'
        ? value
        : DEFAULT_FUME_TUNING.cameraTrackingMode
);

export const readStoredFumeTuning = (): FumeTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_FUME_TUNING;
    }

    const saved = localStorage.getItem('fume_tuning');
    if (!saved) return DEFAULT_FUME_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<FumeTuning> & { textHoldStyle?: 'standard' | 'dimmed'; };
        const migratedTextHoldRatio = parsed.textHoldStyle === 'dimmed'
            ? 0.5
            : DEFAULT_FUME_TUNING.textHoldRatio;
        return {
            hidePrintSymbols: parsed.hidePrintSymbols ?? DEFAULT_FUME_TUNING.hidePrintSymbols,
            disableGeometricBackground: parsed.disableGeometricBackground ?? DEFAULT_FUME_TUNING.disableGeometricBackground,
            backgroundObjectOpacity: clampFumeBackgroundObjectOpacity(
                parsed.backgroundObjectOpacity ?? DEFAULT_FUME_TUNING.backgroundObjectOpacity,
                DEFAULT_FUME_TUNING.backgroundObjectOpacity,
            ),
            textHoldRatio: clampFumeTextHoldRatio(parsed.textHoldRatio ?? migratedTextHoldRatio, DEFAULT_FUME_TUNING.textHoldRatio),
            cameraTrackingMode: resolveFumeCameraTrackingMode(parsed.cameraTrackingMode),
            cameraSpeed: clampFumeCameraSpeed(parsed.cameraSpeed ?? DEFAULT_FUME_TUNING.cameraSpeed, DEFAULT_FUME_TUNING.cameraSpeed),
            glowIntensity: clampFumeGlowIntensity(parsed.glowIntensity ?? DEFAULT_FUME_TUNING.glowIntensity, DEFAULT_FUME_TUNING.glowIntensity),
            heroScale: clampFumeHeroScale(parsed.heroScale ?? DEFAULT_FUME_TUNING.heroScale, DEFAULT_FUME_TUNING.heroScale),
        };
    } catch {
        return DEFAULT_FUME_TUNING;
    }
};

export const clampCladdaghFocusScaleRatio = (val: any, fallback: number = DEFAULT_CLADDAGH_TUNING.focusScaleRatio): number => {
    const parsed = typeof val === 'number' ? val : parseFloat(val);
    return Number.isFinite(parsed) ? Math.min(1.5, Math.max(0.0, parsed)) : fallback;
};

export const clampCladdaghRadiusScale = (val: any, fallback: number = DEFAULT_CLADDAGH_TUNING.radiusScale): number => {
    const parsed = typeof val === 'number' ? val : parseFloat(val);
    return Number.isFinite(parsed) ? Math.min(1.5, Math.max(0.5, parsed)) : fallback;
};

export const clampCladdaghEllipseTiltDeg = (val: any, fallback: number = DEFAULT_CLADDAGH_TUNING.ellipseTiltDeg): number => {
    const parsed = typeof val === 'number' ? val : parseFloat(val);
    return Number.isFinite(parsed) ? Math.min(60, Math.max(0, parsed)) : fallback;
};

export const clampCladdaghLetterSpacingOffset = (val: any, fallback: number = DEFAULT_CLADDAGH_TUNING.letterSpacingOffset): number => {
    const parsed = typeof val === 'number' ? val : parseFloat(val);
    return Number.isFinite(parsed) ? Math.min(20, Math.max(-5, parsed)) : fallback;
};

export const readStoredCladdaghTuning = (): CladdaghTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_CLADDAGH_TUNING;
    }

    const saved = localStorage.getItem('claddagh_tuning');
    if (!saved) return DEFAULT_CLADDAGH_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<CladdaghTuning>;
        return {
            focusScaleRatio: clampCladdaghFocusScaleRatio(parsed.focusScaleRatio, DEFAULT_CLADDAGH_TUNING.focusScaleRatio),
            radiusScale: clampCladdaghRadiusScale(parsed.radiusScale, DEFAULT_CLADDAGH_TUNING.radiusScale),
            ellipseTiltDeg: clampCladdaghEllipseTiltDeg(parsed.ellipseTiltDeg, DEFAULT_CLADDAGH_TUNING.ellipseTiltDeg),
            showAxisLine: typeof parsed.showAxisLine === 'boolean' ? parsed.showAxisLine : DEFAULT_CLADDAGH_TUNING.showAxisLine,
            letterSpacingOffset: clampCladdaghLetterSpacingOffset(parsed.letterSpacingOffset, DEFAULT_CLADDAGH_TUNING.letterSpacingOffset),
        };
    } catch {
        return DEFAULT_CLADDAGH_TUNING;
    }
};

export const resolvePendoloNumber = (value: unknown, fallback: number, min: number, max: number) => (
    typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : fallback
);

export const readStoredPendoloTuning = (): PendoloTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_PENDOLO_TUNING;
    }

    const saved = localStorage.getItem('pendolo_tuning');
    if (!saved) return DEFAULT_PENDOLO_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<PendoloTuning>;
        return {
            arcRadius: resolvePendoloNumber(parsed.arcRadius, DEFAULT_PENDOLO_TUNING.arcRadius, 0.25, 0.80),
            arcAngleDeg: resolvePendoloNumber(parsed.arcAngleDeg, DEFAULT_PENDOLO_TUNING.arcAngleDeg, 40, 160),
            wheelCenterX: resolvePendoloNumber(parsed.wheelCenterX, DEFAULT_PENDOLO_TUNING.wheelCenterX, -0.30, 0.50),
            wheelCenterY: resolvePendoloNumber(parsed.wheelCenterY, DEFAULT_PENDOLO_TUNING.wheelCenterY, 0.20, 0.80),
            tickSnappiness: resolvePendoloNumber(parsed.tickSnappiness, DEFAULT_PENDOLO_TUNING.tickSnappiness, 0.5, 2.0),
            activeScale: resolvePendoloNumber(parsed.activeScale, DEFAULT_PENDOLO_TUNING.activeScale, 1.00, 1.60),
            showGearDecor: parsed.showGearDecor === 'none' || parsed.showGearDecor === 'full' ? parsed.showGearDecor : 'subtle',
            showCenterGradient: typeof parsed.showCenterGradient === 'boolean'
                ? parsed.showCenterGradient
                : DEFAULT_PENDOLO_TUNING.showCenterGradient,
            showCoverOnWatchFace: typeof parsed.showCoverOnWatchFace === 'boolean'
                ? parsed.showCoverOnWatchFace
                : DEFAULT_PENDOLO_TUNING.showCoverOnWatchFace,
            enableLineGlow: typeof parsed.enableLineGlow === 'boolean'
                ? parsed.enableLineGlow
                : DEFAULT_PENDOLO_TUNING.enableLineGlow,
        };
    } catch {
        return DEFAULT_PENDOLO_TUNING;
    }
};

export const readStoredSonnetTuning = (): SonnetTuning => {
    if (typeof window === 'undefined') return DEFAULT_SONNET_TUNING;
    const saved = localStorage.getItem('sonnet_tuning');
    if (!saved) return DEFAULT_SONNET_TUNING;
    try {
        const parsed = JSON.parse(saved) as Partial<SonnetTuning>;
        return {
            // 旧数据兼容：以前这里能存到 2，而镜头运动超过 0.7 会把画面甩出屏幕外，
            // 所以读出来时一并夹到新上限（见 SONNET_CAMERA_INTENSITY_MAX）。
            cameraIntensity: resolvePendoloNumber(
                parsed.cameraIntensity,
                DEFAULT_SONNET_TUNING.cameraIntensity,
                0,
                SONNET_CAMERA_INTENSITY_MAX,
            ),
            typographyMotion: resolvePendoloNumber(parsed.typographyMotion, DEFAULT_SONNET_TUNING.typographyMotion, 0, 2),
            mgDensity: resolvePendoloNumber(parsed.mgDensity, DEFAULT_SONNET_TUNING.mgDensity, 0, 2),
            showOnlyText: typeof parsed.showOnlyText === 'boolean'
                ? parsed.showOnlyText
                : DEFAULT_SONNET_TUNING.showOnlyText,
            showGuide: typeof parsed.showGuide === 'boolean'
                ? parsed.showGuide
                : DEFAULT_SONNET_TUNING.showGuide,
            showBackgroundMg: typeof parsed.showBackgroundMg === 'boolean'
                ? parsed.showBackgroundMg
                : DEFAULT_SONNET_TUNING.showBackgroundMg,
            showFixedGeo: typeof parsed.showFixedGeo === 'boolean'
                ? parsed.showFixedGeo
                : DEFAULT_SONNET_TUNING.showFixedGeo,
            showGiantDecorativeText: typeof parsed.showGiantDecorativeText === 'boolean'
                ? parsed.showGiantDecorativeText
                : DEFAULT_SONNET_TUNING.showGiantDecorativeText,
            showBackgroundDecor: typeof parsed.showBackgroundDecor === 'boolean'
                ? parsed.showBackgroundDecor
                : DEFAULT_SONNET_TUNING.showBackgroundDecor,
            enableTransitions: typeof parsed.enableTransitions === 'boolean'
                ? parsed.enableTransitions
                : DEFAULT_SONNET_TUNING.enableTransitions,
            outerFrameMode: parsed.outerFrameMode === 'none'
                || parsed.outerFrameMode === 'frame'
                || parsed.outerFrameMode === 'full'
                ? parsed.outerFrameMode
                : DEFAULT_SONNET_TUNING.outerFrameMode,
            textureResolution: resolvePendoloNumber(parsed.textureResolution, DEFAULT_SONNET_TUNING.textureResolution, 0.5, 4),
            postProcessEnabled: typeof parsed.postProcessEnabled === 'boolean'
                ? parsed.postProcessEnabled
                : DEFAULT_SONNET_TUNING.postProcessEnabled,
            postProcessGrain: resolvePendoloNumber(parsed.postProcessGrain, DEFAULT_SONNET_TUNING.postProcessGrain, 0, 1),
            postProcessContrast: resolvePendoloNumber(parsed.postProcessContrast, DEFAULT_SONNET_TUNING.postProcessContrast, 0, 1),
            postProcessRgbShift: resolvePendoloNumber(parsed.postProcessRgbShift, DEFAULT_SONNET_TUNING.postProcessRgbShift, 0, 1),
            postProcessHalftone: resolvePendoloNumber(parsed.postProcessHalftone, DEFAULT_SONNET_TUNING.postProcessHalftone, 0, 1),
            postProcessVignette: resolvePendoloNumber(parsed.postProcessVignette, DEFAULT_SONNET_TUNING.postProcessVignette, 0, 2),
            postProcessLensDistortion: resolvePendoloNumber(parsed.postProcessLensDistortion, DEFAULT_SONNET_TUNING.postProcessLensDistortion, 0, 2),
            postProcessLensDispersion: resolvePendoloNumber(parsed.postProcessLensDispersion, DEFAULT_SONNET_TUNING.postProcessLensDispersion, 0, 1),
        };
    } catch {
        return DEFAULT_SONNET_TUNING;
    }
};

export const clampUnit = (value: unknown, fallback: number) => (
    typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
);

/**
 * Placement records ride in the tuning, so they arrive from localStorage, sync and pasted
 * appearance codes alike. Every field is clamped rather than trusted; a bad scale would put a
 * user's artwork off screen with no way to find it again.
 */
export const sanitizeTemperaLayerImages = (value: unknown): TemperaLayerImage[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap<TemperaLayerImage>(entry => {
        if (!entry || typeof entry !== 'object') return [];
        const record = entry as Partial<TemperaLayerImage>;
        if (typeof record.id !== 'string' || !record.id) return [];
        const align = record.align;
        const verticalAlign = record.verticalAlign;
        return [{
            id: record.id,
            name: typeof record.name === 'string' ? record.name : record.id,
            align: align === 'left' || align === 'center' || align === 'right' || align === 'free'
                ? align
                : DEFAULT_TEMPERA_LAYER_IMAGE.align,
            verticalAlign: verticalAlign === 'top'
                || verticalAlign === 'center'
                || verticalAlign === 'bottom'
                || verticalAlign === 'free'
                ? verticalAlign
                : DEFAULT_TEMPERA_LAYER_IMAGE.verticalAlign,
            scale: typeof record.scale === 'number' && Number.isFinite(record.scale)
                ? Math.min(2, Math.max(0.05, record.scale))
                : DEFAULT_TEMPERA_LAYER_IMAGE.scale,
            opacity: clampUnit(record.opacity, DEFAULT_TEMPERA_LAYER_IMAGE.opacity),
        }];
    }).slice(0, TEMPERA_MAX_LAYER_IMAGES);
};

export const resolveStoredTemperaTuning = (parsed: Partial<TemperaTuning>): TemperaTuning => ({
    cameraIntensity: resolvePendoloNumber(parsed.cameraIntensity, DEFAULT_TEMPERA_TUNING.cameraIntensity, 0, 2),
    glyphMotion: resolvePendoloNumber(parsed.glyphMotion, DEFAULT_TEMPERA_TUNING.glyphMotion, 0, 2),
    wholeLineLyrics: typeof parsed.wholeLineLyrics === 'boolean'
        ? parsed.wholeLineLyrics
        : DEFAULT_TEMPERA_TUNING.wholeLineLyrics,
    glyphSettleStretch: resolvePendoloNumber(parsed.glyphSettleStretch, DEFAULT_TEMPERA_TUNING.glyphSettleStretch, 0, 1),
    colorMode: parsed.colorMode === 'mono' || parsed.colorMode === 'gradient' ? parsed.colorMode : DEFAULT_TEMPERA_TUNING.colorMode,
    textInversion: typeof parsed.textInversion === 'boolean' ? parsed.textInversion : DEFAULT_TEMPERA_TUNING.textInversion,
    layerImages: sanitizeTemperaLayerImages(parsed.layerImages),
    layerImageDepth: parsed.layerImageDepth === 'front' ? 'front' : 'back',
    layerImageFrequency: clampUnit(parsed.layerImageFrequency, DEFAULT_TEMPERA_TUNING.layerImageFrequency),
    showBlocks: typeof parsed.showBlocks === 'boolean'
        ? parsed.showBlocks
        : DEFAULT_TEMPERA_TUNING.showBlocks,
    showDecor: typeof parsed.showDecor === 'boolean'
        ? parsed.showDecor
        : DEFAULT_TEMPERA_TUNING.showDecor,
    showCornerMarks: typeof parsed.showCornerMarks === 'boolean'
        ? parsed.showCornerMarks
        : DEFAULT_TEMPERA_TUNING.showCornerMarks,
    enableTransitions: typeof parsed.enableTransitions === 'boolean'
        ? parsed.enableTransitions
        : DEFAULT_TEMPERA_TUNING.enableTransitions,
    textureResolution: resolvePendoloNumber(parsed.textureResolution, DEFAULT_TEMPERA_TUNING.textureResolution, 0.5, 4),
    postProcessEnabled: typeof parsed.postProcessEnabled === 'boolean'
        ? parsed.postProcessEnabled
        : DEFAULT_TEMPERA_TUNING.postProcessEnabled,
    postProcessTextureCompression: typeof parsed.postProcessTextureCompression === 'boolean'
        ? parsed.postProcessTextureCompression
        : DEFAULT_TEMPERA_TUNING.postProcessTextureCompression,
    postProcessGrain: resolvePendoloNumber(parsed.postProcessGrain, DEFAULT_TEMPERA_TUNING.postProcessGrain, 0, 1),
    postProcessContrast: resolvePendoloNumber(parsed.postProcessContrast, DEFAULT_TEMPERA_TUNING.postProcessContrast, 0, 1),
    postProcessRgbShift: resolvePendoloNumber(parsed.postProcessRgbShift, DEFAULT_TEMPERA_TUNING.postProcessRgbShift, 0, 1),
    postProcessVignette: resolvePendoloNumber(parsed.postProcessVignette, DEFAULT_TEMPERA_TUNING.postProcessVignette, 0, 2),
    postProcessLensDistortion: resolvePendoloNumber(parsed.postProcessLensDistortion, DEFAULT_TEMPERA_TUNING.postProcessLensDistortion, 0, 2),
});

export const readStoredTemperaTuning = (): TemperaTuning => {
    if (typeof window === 'undefined') return DEFAULT_TEMPERA_TUNING;
    const saved = localStorage.getItem('tempera_tuning');
    if (!saved) return DEFAULT_TEMPERA_TUNING;
    try {
        return resolveStoredTemperaTuning(JSON.parse(saved) as Partial<TemperaTuning>);
    } catch {
        return DEFAULT_TEMPERA_TUNING;
    }
};

export const LUMIERE_TUNING_STORAGE_KEY = 'lumiere_tuning';

export const readStoredLumiereTuning = (): LumiereTuning => {
    if (typeof window === 'undefined') return DEFAULT_LUMIERE_TUNING;
    const saved = localStorage.getItem(LUMIERE_TUNING_STORAGE_KEY);
    if (!saved) return DEFAULT_LUMIERE_TUNING;
    try {
        return normalizeLumiereTuning(JSON.parse(saved));
    } catch {
        return DEFAULT_LUMIERE_TUNING;
    }
};

export const resolveCappellaAvatarSource = (source: CappellaAvatarSource | undefined): CappellaAvatarSource => (
    source === 'builtin' || source === 'color' || source === 'cover' || source === 'custom'
        ? source
        : DEFAULT_CAPPELLA_TUNING.avatarSource
);

export const resolveStoredCappellaTuning = (parsed: Partial<CappellaTuning>): CappellaTuning => ({
    showEmoMessages: parsed.showEmoMessages ?? DEFAULT_CAPPELLA_TUNING.showEmoMessages,
    emojiPackSource: parsed.emojiPackSource === 'custom' ? 'custom' : 'builtin',
    avatarSource: resolveCappellaAvatarSource(parsed.avatarSource),
});

export const readStoredCappellaTuning = (): CappellaTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_CAPPELLA_TUNING;
    }

    const saved = localStorage.getItem('cappella_tuning');
    if (!saved) return DEFAULT_CAPPELLA_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<CappellaTuning>;
        return resolveStoredCappellaTuning(parsed);
    } catch {
        return DEFAULT_CAPPELLA_TUNING;
    }
};

export const readStoredTiltTuning = (): TiltTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_TILT_TUNING;
    }

    const saved = localStorage.getItem('tilt_tuning');
    if (!saved) return DEFAULT_TILT_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<TiltTuning>;
        return {
            splitProbability: Math.min(1, Math.max(0, parsed.splitProbability ?? DEFAULT_TILT_TUNING.splitProbability)),
            tiltStyleProbability: Math.min(1, Math.max(0, parsed.tiltStyleProbability ?? DEFAULT_TILT_TUNING.tiltStyleProbability)),
            colorScheme: parsed.colorScheme ?? DEFAULT_TILT_TUNING.colorScheme,
        };
    } catch {
        return DEFAULT_TILT_TUNING;
    }
};

export const resolveStoredDioramaTuning = (parsed: Partial<DioramaTuning>): DioramaTuning => ({
    cameraSpeed: Math.min(1.85, Math.max(0.55, parsed.cameraSpeed ?? DEFAULT_DIORAMA_TUNING.cameraSpeed)),
    motionAmount: Math.min(1.6, Math.max(0.4, parsed.motionAmount ?? DEFAULT_DIORAMA_TUNING.motionAmount)),
    audioReactivity: Math.min(1.5, Math.max(0, parsed.audioReactivity ?? DEFAULT_DIORAMA_TUNING.audioReactivity)),
    geometryVisibility: {
        enabled: parsed.geometryVisibility?.enabled ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.enabled,
        mode: parsed.geometryVisibility?.mode ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.mode,
        strands: parsed.geometryVisibility?.strands ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.strands,
        blobs: parsed.geometryVisibility?.blobs ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.blobs,
        ribbons: parsed.geometryVisibility?.ribbons ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.ribbons,
        rings: parsed.geometryVisibility?.rings ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.rings,
    },
    particleDensity: Math.round(Math.min(
        DIORAMA_PARTICLE_DENSITY_MAX,
        Math.max(DIORAMA_PARTICLE_DENSITY_MIN, parsed.particleDensity ?? DEFAULT_DIORAMA_TUNING.particleDensity),
    )),
    particleScale: Math.min(
        DIORAMA_PARTICLE_SIZE_MAX,
        Math.max(DIORAMA_PARTICLE_SIZE_MIN, parsed.particleScale ?? DEFAULT_DIORAMA_TUNING.particleScale),
    ),
    particleGlowEnabled: parsed.particleGlowEnabled ?? DEFAULT_DIORAMA_TUNING.particleGlowEnabled,
    particleGlowIntensity: Math.min(
        DIORAMA_PARTICLE_GLOW_INTENSITY_MAX,
        Math.max(
            DIORAMA_PARTICLE_GLOW_INTENSITY_MIN,
            parsed.particleGlowIntensity ?? DEFAULT_DIORAMA_TUNING.particleGlowIntensity,
        ),
    ),
    showParticles: parsed.showParticles ?? DEFAULT_DIORAMA_TUNING.showParticles,
    backgroundParticleCircumference: resolveDioramaMoteCircumference(
        parsed.backgroundParticleCircumference ?? DEFAULT_DIORAMA_TUNING.backgroundParticleCircumference,
    ),
    backgroundParticleRadial: resolveDioramaMoteRadial(
        parsed.backgroundParticleRadial ?? DEFAULT_DIORAMA_TUNING.backgroundParticleRadial,
    ),
    glowEnabled: parsed.glowEnabled ?? DEFAULT_DIORAMA_TUNING.glowEnabled,
    glowIntensity: Math.min(1.5, Math.max(0.1, parsed.glowIntensity ?? DEFAULT_DIORAMA_TUNING.glowIntensity)),
    soulEnabled: parsed.soulEnabled ?? DEFAULT_DIORAMA_TUNING.soulEnabled,
    soulIntensity: Math.min(1.5, Math.max(0.1, parsed.soulIntensity ?? DEFAULT_DIORAMA_TUNING.soulIntensity)),
    soulActiveEnabled: parsed.soulActiveEnabled ?? DEFAULT_DIORAMA_TUNING.soulActiveEnabled,
    gradientEnabled: parsed.gradientEnabled ?? DEFAULT_DIORAMA_TUNING.gradientEnabled,
    gradientIntensity: Math.min(1.5, Math.max(0.1, parsed.gradientIntensity ?? DEFAULT_DIORAMA_TUNING.gradientIntensity)),
    keywordColoringEnabled: parsed.keywordColoringEnabled ?? DEFAULT_DIORAMA_TUNING.keywordColoringEnabled,
});

export const readStoredDioramaTuning = (): DioramaTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_DIORAMA_TUNING;
    }

    const saved = localStorage.getItem('diorama_tuning');
    if (!saved) return DEFAULT_DIORAMA_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<DioramaTuning>;
        return resolveStoredDioramaTuning(parsed);
    } catch {
        return DEFAULT_DIORAMA_TUNING;
    }
};

export const resolveMonetBackgroundSource = (value: MonetBackgroundSource | undefined): MonetBackgroundSource => (
    value === 'uploaded-global' ? 'uploaded-global' : DEFAULT_MONET_BACKGROUND_TUNING.backgroundSource
);

export const resolveMonetBackgroundLayout = (value: MonetBackgroundLayout | undefined): MonetBackgroundLayout => (
    value === 'full-overlay' || value === 'half-pane-gradient'
        ? value
        : DEFAULT_MONET_BACKGROUND_TUNING.backgroundLayout
);

export const resolveMonetBackgroundWashColorMode = (
    value: MonetBackgroundWashColorMode | undefined,
): MonetBackgroundWashColorMode => (
    value === 'custom' ? 'custom' : DEFAULT_MONET_BACKGROUND_TUNING.backgroundWashColorMode
);

export const clampMonetBackgroundBlur = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(60, Math.max(0, value));
};

export const clampUnitInterval = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1, Math.max(0, value));
};

export const clampMonetBackgroundSaturation = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(2, Math.max(0, value));
};

export const clampMonetBackgroundOffsetX = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(40, Math.max(-40, value));
};

export const clampMonetFontScale = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.5, Math.max(0.7, value));
};

export const normalizeHexColor = (value: unknown, fallback: string) => {
    if (typeof value !== 'string') {
        return fallback;
    }

    const trimmed = value.trim();
    const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
    if (!/^[0-9a-fA-F]{6}$/.test(withoutHash)) {
        return fallback;
    }

    return `#${withoutHash.toLowerCase()}`;
};

export const resolveMonetPortraitSource = (value: MonetPortraitSource | undefined): MonetPortraitSource => (
    value === 'custom' ? 'custom' : DEFAULT_MONET_TUNING.portraitSource
);

export const readStoredVisualizerBackgroundMode = (): VisualizerBackgroundMode | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    const saved = localStorage.getItem('visualizer_background_mode');
    return isBuiltinVisualizerBackgroundMode(saved) ? saved : null;
};

export const readStoredUrlBackgroundList = (): UrlBackgroundItem[] => {
    if (typeof window === 'undefined') return [];
    try {
        const saved = localStorage.getItem('url_background_list');
        if (!saved) return [];
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return [];
        return sanitizeUrlBackgroundList(parsed);
    } catch {
        return [];
    }
};

export const readStoredUrlBackgroundSelectedId = (): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('url_background_selected_id') || null;
};

export const resolveVisualizerBackgroundMode = (
    storedMode: VisualizerBackgroundMode | null | undefined,
    _visualizerMode: VisualizerMode,
): VisualizerBackgroundMode => storedMode ?? DEFAULT_VISUALIZER_BACKGROUND_MODE;

export type StoredMonetBackgroundTuningInput = Partial<MonetBackgroundTuning> & {
    backgroundCropMode?: unknown;
    coverPaneRatio?: unknown;
    lyricsFocusScale?: unknown;
};

export const resolveStoredMonetBackgroundTuning = (parsed: StoredMonetBackgroundTuningInput): MonetBackgroundTuning => ({
    backgroundSource: resolveMonetBackgroundSource(parsed.backgroundSource),
    backgroundLayout: resolveMonetBackgroundLayout(parsed.backgroundLayout),
    backgroundBlurPx: clampMonetBackgroundBlur(
        parsed.backgroundBlurPx ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundBlurPx,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundBlurPx,
    ),
    backgroundOverlayOpacity: clampUnitInterval(
        parsed.backgroundOverlayOpacity ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundOverlayOpacity,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundOverlayOpacity,
    ),
    backgroundGrayscale: clampUnitInterval(
        parsed.backgroundGrayscale ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundGrayscale,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundGrayscale,
    ),
    backgroundSaturation: clampMonetBackgroundSaturation(
        parsed.backgroundSaturation ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundSaturation,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundSaturation,
    ),
    backgroundWash: clampUnitInterval(
        parsed.backgroundWash ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundWash,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundWash,
    ),
    backgroundHalfPaneOffsetX: clampMonetBackgroundOffsetX(
        parsed.backgroundHalfPaneOffsetX ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundHalfPaneOffsetX,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundHalfPaneOffsetX,
    ),
    backgroundWashColorMode: resolveMonetBackgroundWashColorMode(parsed.backgroundWashColorMode),
    backgroundWashCustomColor: normalizeHexColor(
        parsed.backgroundWashCustomColor,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundWashCustomColor,
    ),
    backgroundDriftEnabled: parsed.backgroundDriftEnabled ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftEnabled,
    backgroundDriftStrength: clampUnitInterval(
        parsed.backgroundDriftStrength ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftStrength,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftStrength,
    ),
    backgroundStreaksEnabled: parsed.backgroundStreaksEnabled ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundStreaksEnabled,
});

export const resolveNomandBackgroundSource = (value: NomandBackgroundSource | undefined): NomandBackgroundSource => (
    value === 'uploaded-global' ? 'uploaded-global' : DEFAULT_NOMAND_BACKGROUND_TUNING.imageSource
);

export const resolveNomandDitheringType = (
    value: unknown,
): NomandBackgroundDitheringType => (
    value === '2x2' || value === '4x4' || value === '8x8'
        ? value
        : DEFAULT_NOMAND_BACKGROUND_TUNING.ditheringType
);

export const resolveNomandBackgroundEffect = (value: unknown): NomandBackgroundEffect => (
    value === 'fluted-glass'
        || value === 'paper-texture'
        || value === 'halftone-dots'
        || value === 'lens-distortion'
        || value === 'dithering'
        ? value
        : DEFAULT_NOMAND_BACKGROUND_TUNING.effect
);

export const clampNomandEffectValue = (value: unknown, fallback: number, min = 0, max = 1) => (
    Math.min(max, Math.max(min, typeof value === 'number' && Number.isFinite(value) ? value : fallback))
);

export type StoredNomandBackgroundTuningInput = Omit<Partial<NomandBackgroundTuning>, 'ditheringType' | 'effect'> & {
    ditheringType?: unknown;
    effect?: unknown;
};

export const resolveStoredNomandBackgroundTuning = (
    parsed: StoredNomandBackgroundTuningInput,
): NomandBackgroundTuning => ({
    imageSource: resolveNomandBackgroundSource(parsed.imageSource),
    effect: resolveNomandBackgroundEffect(parsed.effect),
    ditheringType: resolveNomandDitheringType(parsed.ditheringType),
    size: Math.min(20, Math.max(0.5, Number.isFinite(parsed.size) ? parsed.size! : DEFAULT_NOMAND_BACKGROUND_TUNING.size)),
    colorSteps: Math.min(7, Math.max(1, Math.round(Number.isFinite(parsed.colorSteps) ? parsed.colorSteps! : DEFAULT_NOMAND_BACKGROUND_TUNING.colorSteps))),
    originalColors: parsed.originalColors ?? DEFAULT_NOMAND_BACKGROUND_TUNING.originalColors,
    inverted: parsed.inverted ?? DEFAULT_NOMAND_BACKGROUND_TUNING.inverted,
    flutedGlassSize: clampNomandEffectValue(
        parsed.flutedGlassSize,
        DEFAULT_NOMAND_BACKGROUND_TUNING.flutedGlassSize,
        0.1,
    ),
    flutedGlassDistortion: clampNomandEffectValue(
        parsed.flutedGlassDistortion,
        DEFAULT_NOMAND_BACKGROUND_TUNING.flutedGlassDistortion,
    ),
    flutedGlassBlur: clampNomandEffectValue(
        parsed.flutedGlassBlur,
        DEFAULT_NOMAND_BACKGROUND_TUNING.flutedGlassBlur,
    ),
    paperTextureContrast: clampNomandEffectValue(
        parsed.paperTextureContrast,
        DEFAULT_NOMAND_BACKGROUND_TUNING.paperTextureContrast,
    ),
    paperTextureRoughness: clampNomandEffectValue(
        parsed.paperTextureRoughness,
        DEFAULT_NOMAND_BACKGROUND_TUNING.paperTextureRoughness,
    ),
    paperTextureFiber: clampNomandEffectValue(
        parsed.paperTextureFiber,
        DEFAULT_NOMAND_BACKGROUND_TUNING.paperTextureFiber,
    ),
    halftoneDotsSize: clampNomandEffectValue(
        parsed.halftoneDotsSize,
        DEFAULT_NOMAND_BACKGROUND_TUNING.halftoneDotsSize,
        0.1,
    ),
    halftoneDotsRadius: clampNomandEffectValue(
        parsed.halftoneDotsRadius,
        DEFAULT_NOMAND_BACKGROUND_TUNING.halftoneDotsRadius,
        0.1,
        2,
    ),
    halftoneDotsContrast: clampNomandEffectValue(
        parsed.halftoneDotsContrast,
        DEFAULT_NOMAND_BACKGROUND_TUNING.halftoneDotsContrast,
    ),
    halftoneDotsOriginalColors: parsed.halftoneDotsOriginalColors ?? DEFAULT_NOMAND_BACKGROUND_TUNING.halftoneDotsOriginalColors,
    halftoneDotsInverted: parsed.halftoneDotsInverted ?? DEFAULT_NOMAND_BACKGROUND_TUNING.halftoneDotsInverted,
    lensDistortionSpread: clampNomandEffectValue(
        parsed.lensDistortionSpread,
        DEFAULT_NOMAND_BACKGROUND_TUNING.lensDistortionSpread,
    ),
    lensDistortionBulge: clampNomandEffectValue(
        parsed.lensDistortionBulge,
        DEFAULT_NOMAND_BACKGROUND_TUNING.lensDistortionBulge,
        -1,
        1,
    ),
    lensDistortionDispersion: clampNomandEffectValue(
        parsed.lensDistortionDispersion,
        DEFAULT_NOMAND_BACKGROUND_TUNING.lensDistortionDispersion,
    ),
    overlayEnabled: typeof parsed.overlayEnabled === 'boolean'
        ? parsed.overlayEnabled
        : DEFAULT_NOMAND_BACKGROUND_TUNING.overlayEnabled,
    overlayOpacity: Math.min(1, Math.max(0,
        Number.isFinite(parsed.overlayOpacity)
            ? parsed.overlayOpacity!
            : DEFAULT_NOMAND_BACKGROUND_TUNING.overlayOpacity
    )),
});

export const readStoredNomandBackgroundTuning = (): NomandBackgroundTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_NOMAND_BACKGROUND_TUNING;
    }

    const saved = localStorage.getItem('nomand_background_tuning');
    if (!saved) return DEFAULT_NOMAND_BACKGROUND_TUNING;

    try {
        return resolveStoredNomandBackgroundTuning(JSON.parse(saved) as Partial<NomandBackgroundTuning>);
    } catch {
        return DEFAULT_NOMAND_BACKGROUND_TUNING;
    }
};

export const resolveLatentDisplayMode = (value: unknown): LatentBackgroundDisplayMode => (
    value === 'dithering' || value === 'mesh' || value === 'both'
        ? value
        : DEFAULT_LATENT_BACKGROUND_TUNING.displayMode
);

export const resolveLatentColorSource = (value: unknown): LatentBackgroundColorSource => (
    value === 'cover-only' ? 'cover-only' : DEFAULT_LATENT_BACKGROUND_TUNING.colorSource
);

export const clampLatentNumber = (value: unknown, fallback: number, min: number, max: number) => (
    Math.min(max, Math.max(min, typeof value === 'number' && Number.isFinite(value) ? value : fallback))
);

export const resolveStoredLatentBackgroundTuning = (
    parsed: Partial<LatentBackgroundTuning>,
): LatentBackgroundTuning => ({
    displayMode: resolveLatentDisplayMode(parsed.displayMode),
    colorSource: resolveLatentColorSource(parsed.colorSource),
    dynamicOnlyInPlayer: typeof parsed.dynamicOnlyInPlayer === 'boolean'
        ? parsed.dynamicOnlyInPlayer
        : DEFAULT_LATENT_BACKGROUND_TUNING.dynamicOnlyInPlayer,
    enhancedBeatResponse: typeof parsed.enhancedBeatResponse === 'boolean'
        ? parsed.enhancedBeatResponse
        : DEFAULT_LATENT_BACKGROUND_TUNING.enhancedBeatResponse,
    ditheringSpeed: clampLatentNumber(parsed.ditheringSpeed, DEFAULT_LATENT_BACKGROUND_TUNING.ditheringSpeed, 0, 2),
    ditheringAudioSpeed: clampLatentNumber(parsed.ditheringAudioSpeed, DEFAULT_LATENT_BACKGROUND_TUNING.ditheringAudioSpeed, 0, 2),
    ditheringSize: clampLatentNumber(parsed.ditheringSize, DEFAULT_LATENT_BACKGROUND_TUNING.ditheringSize, 0.5, 8),
    ditheringOpacity: clampLatentNumber(parsed.ditheringOpacity, DEFAULT_LATENT_BACKGROUND_TUNING.ditheringOpacity, 0, 1),
    meshSpeed: clampLatentNumber(parsed.meshSpeed, DEFAULT_LATENT_BACKGROUND_TUNING.meshSpeed, 0, 2),
    meshAudioSpeed: clampLatentNumber(parsed.meshAudioSpeed, DEFAULT_LATENT_BACKGROUND_TUNING.meshAudioSpeed, 0, 2),
    meshDistortion: clampLatentNumber(parsed.meshDistortion, DEFAULT_LATENT_BACKGROUND_TUNING.meshDistortion, 0, 2),
    meshSwirl: clampLatentNumber(parsed.meshSwirl, DEFAULT_LATENT_BACKGROUND_TUNING.meshSwirl, 0, 1),
    overlayEnabled: typeof parsed.overlayEnabled === 'boolean'
        ? parsed.overlayEnabled
        : DEFAULT_LATENT_BACKGROUND_TUNING.overlayEnabled,
    overlayOpacity: clampLatentNumber(parsed.overlayOpacity, DEFAULT_LATENT_BACKGROUND_TUNING.overlayOpacity, 0, 1),
});

export const readStoredLatentBackgroundTuning = (): LatentBackgroundTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_LATENT_BACKGROUND_TUNING;
    }

    const saved = localStorage.getItem('latent_background_tuning');
    if (!saved) return DEFAULT_LATENT_BACKGROUND_TUNING;

    try {
        return resolveStoredLatentBackgroundTuning(JSON.parse(saved) as Partial<LatentBackgroundTuning>);
    } catch {
        return DEFAULT_LATENT_BACKGROUND_TUNING;
    }
};

export const resolveStoredSoraBackgroundTuning = (
    parsed: Partial<SoraBackgroundTuning>,
): SoraBackgroundTuning => ({
    blank: typeof parsed.blank === 'boolean' ? parsed.blank : DEFAULT_SORA_BACKGROUND_TUNING.blank,
});

export const readStoredSoraBackgroundTuning = (): SoraBackgroundTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_SORA_BACKGROUND_TUNING;
    }

    const saved = localStorage.getItem('sora_background_tuning');
    if (!saved) return DEFAULT_SORA_BACKGROUND_TUNING;

    try {
        return resolveStoredSoraBackgroundTuning(JSON.parse(saved) as Partial<SoraBackgroundTuning>);
    } catch {
        return DEFAULT_SORA_BACKGROUND_TUNING;
    }
};

export type StoredMonetTuningInput = Partial<MonetTuning> & StoredMonetBackgroundTuningInput;
export const resolveStoredMonetTuning = (parsed: StoredMonetTuningInput): MonetTuning => ({
    keywordColoringEnabled: parsed.keywordColoringEnabled ?? DEFAULT_MONET_TUNING.keywordColoringEnabled,
    showDescription: parsed.showDescription ?? DEFAULT_MONET_TUNING.showDescription,
    showAudioVisualization: parsed.showAudioVisualization ?? DEFAULT_MONET_TUNING.showAudioVisualization,
    audioStyle: parsed.audioStyle === 'line' ? 'line' : DEFAULT_MONET_TUNING.audioStyle,
    fontScale: clampMonetFontScale(
        parsed.fontScale ?? DEFAULT_MONET_TUNING.fontScale,
        DEFAULT_MONET_TUNING.fontScale,
    ),
    portraitSource: resolveMonetPortraitSource(parsed.portraitSource),
    portraitOffsetX: typeof parsed.portraitOffsetX === 'number'
        ? Math.min(0, Math.max(-150, parsed.portraitOffsetX))
        : (DEFAULT_MONET_TUNING.portraitOffsetX ?? 0),
    portraitStyle: parsed.portraitStyle === 'rectangular' ? 'rectangular' : DEFAULT_MONET_TUNING.portraitStyle,
    showPortraitDragHanger: parsed.showPortraitDragHanger ?? DEFAULT_MONET_TUNING.showPortraitDragHanger,
});
export const readStoredMonetBackgroundTuning = (): MonetBackgroundTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_MONET_BACKGROUND_TUNING;
    }

    const saved = localStorage.getItem('monet_background_tuning') ?? localStorage.getItem('monet_tuning');
    if (!saved) return DEFAULT_MONET_BACKGROUND_TUNING;

    try {
        const parsed = JSON.parse(saved) as StoredMonetBackgroundTuningInput;
        return resolveStoredMonetBackgroundTuning(parsed);
    } catch {
        return DEFAULT_MONET_BACKGROUND_TUNING;
    }
};

export const readStoredMonetTuning = (): MonetTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_MONET_TUNING;
    }

    const saved = localStorage.getItem('monet_tuning');
    if (!saved) return DEFAULT_MONET_TUNING;

    try {
        const parsed = JSON.parse(saved) as StoredMonetTuningInput;
        return resolveStoredMonetTuning(parsed);
    } catch {
        return DEFAULT_MONET_TUNING;
    }
};
