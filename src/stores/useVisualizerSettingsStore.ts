// src/stores/useVisualizerSettingsStore.ts
// Visualizer and background settings: the active mode, the background mode and URL background
// list, opacity/frame-rate, and the fifteen per-mode tuning objects.
//
// Split out of useSettingsUiStore. Persistence (localStorage reads, clamping, defaults) lives in
// ./visualizerSettingsPersistence; this file owns the state and the actions only.

import { create } from 'zustand';
import { getVisualizerModeLabel } from '../utils/visualizerModeLabel';
import { DEFAULT_CADENZA_TUNING, DEFAULT_CAPPELLA_TUNING, DEFAULT_CLADDAGH_TUNING, DEFAULT_CLASSIC_TUNING, DEFAULT_DIORAMA_TUNING, DEFAULT_FUME_TUNING, DEFAULT_LATENT_BACKGROUND_TUNING, DEFAULT_LUMIERE_TUNING, DEFAULT_MONET_BACKGROUND_TUNING, DEFAULT_MONET_TUNING, DEFAULT_NOMAND_BACKGROUND_TUNING, DEFAULT_PARTITA_TUNING, DEFAULT_PENDOLO_TUNING, DEFAULT_SONNET_TUNING, DEFAULT_SORA_BACKGROUND_TUNING, DEFAULT_TEMPERA_TUNING, DEFAULT_TILT_TUNING, SONNET_CAMERA_INTENSITY_MAX, type CadenzaTuning, type CappellaTuning, type CladdaghTuning, type ClassicTuning, type DioramaTuning, type FumeTuning, type LatentBackgroundTuning, type LumiereTuning, type MonetBackgroundTuning, type MonetTuning, type NomandBackgroundTuning, type PartitaTuning, type PendoloTuning, type RenderPixelRatio, type SonnetTuning, type SoraBackgroundTuning, type TemperaTuning, type TiltTuning, type UrlBackgroundItem, type VisualizerBackgroundMode, type VisualizerFrameRate, type VisualizerMode } from '../types';
import { VISUALIZER_FRAME_RATE_STORAGE_KEY, setGlobalVisualizerFrameRate } from '../utils/frameRateLimiter';
import { RENDER_PIXEL_RATIO_STORAGE_KEY, readStoredRenderPixelRatio, setGlobalRenderPixelRatio } from '../utils/renderPixelRatio';
import { GLOW_BLUR_QUANTIZE_STORAGE_KEY, readStoredGlowBlurQuantize, setGlowBlurQuantized } from '../utils/glowBlurQuantize';
import { sanitizeUrlBackgroundItem, sanitizeUrlBackgroundList } from '../utils/urlBackground';
import i18n from '../i18n/config';
import { buildStoredCappellaAvatar, clearCustomCappellaAvatar, isSupportedCappellaAvatarFile, saveCustomCappellaAvatar } from '../services/cappellaAvatarPack';
import { buildStoredCappellaEmojiPack, clearCustomCappellaEmojiPack, isSupportedCappellaEmojiFile, saveCustomCappellaEmojiPack } from '../services/cappellaEmojiPack';
import { buildStoredMonetBackgroundImage, clearMonetBackgroundImage, isSupportedMonetBackgroundFile, saveMonetBackgroundImage } from '../services/monetBackgroundImage';
import { buildStoredMonetPortraitImage, clearMonetPortraitImage, isSupportedMonetPortraitFile, saveMonetPortraitImage } from '../services/monetPortraitImage';
import { setStatusMessage } from './useStatusMessageStore';
import { WALLPAPER_FLOATING_OPACITY_STORAGE_KEY, WALLPAPER_OVERLAY_ALL_APPS_STORAGE_KEY, WALLPAPER_OVERLAY_ENABLED_STORAGE_KEY, WALLPAPER_OVERLAY_HIDE_COVER_ART_STORAGE_KEY, WALLPAPER_OVERLAY_LOCK_SCREEN_STORAGE_KEY, WALLPAPER_OVERLAY_LOCK_SCREEN_ONLY_STORAGE_KEY, WALLPAPER_OVERLAY_HIDE_AFTER_LYRICS_END_STORAGE_KEY, WALLPAPER_OVERLAY_HIDE_NATIVE_LYRICS_STORAGE_KEY, WALLPAPER_OVERLAY_HIDE_NATIVE_PROGRESS_STORAGE_KEY, WALLPAPER_OVERLAY_HIDE_WHEN_PAUSED_STORAGE_KEY, WALLPAPER_OVERLAY_OPACITY_STORAGE_KEY, WALLPAPER_OVERLAY_SKIP_INSTRUMENTAL_STORAGE_KEY } from './visualizerSettingsPersistence';
import { LUMIERE_TUNING_STORAGE_KEY, VISUALIZER_OPACITY_STORAGE_KEY, WALLPAPER_FLOATING_OFFSET_X_STORAGE_KEY, WALLPAPER_FLOATING_OVER_SAFE_AREA_STORAGE_KEY, WALLPAPER_FLOATING_FONT_SIZE_MODE_STORAGE_KEY, WALLPAPER_FLOATING_FONT_SIZE_STORAGE_KEY,
WALLPAPER_FLOATING_FILL_SAFE_AREA_STORAGE_KEY, WALLPAPER_FLOATING_AVOID_WIDTH_STORAGE_KEY, WALLPAPER_FLOATING_AVOID_OFFSET_X_STORAGE_KEY,
WALLPAPER_LYRICS_FONT_MODE_STORAGE_KEY,
WALLPAPER_FLOATING_WIDTH_STORAGE_KEY, clampCladdaghEllipseTiltDeg, clampCladdaghFocusScaleRatio, clampCladdaghLetterSpacingOffset, clampCladdaghRadiusScale, clampClassicBreathingFloatMultiplier, clampClassicWordSpacing, clampFumeBackgroundObjectOpacity, clampFumeCameraSpeed, clampFumeGlowIntensity, clampFumeHeroScale, clampFumeTextHoldRatio, clampPartitaStagger, clampUnit, readStoredBackgroundOpacity, readStoredCadenzaTuning, readStoredCappellaTuning, readStoredCladdaghTuning, readStoredClassicTuning, readStoredDioramaTuning, readStoredFumeTuning, readStoredLatentBackgroundTuning, readStoredLumiereTuning, readStoredMonetBackgroundTuning, readStoredMonetTuning, readStoredNomandBackgroundTuning, readStoredPartitaTuning, readStoredPendoloTuning, readStoredSonnetTuning, readStoredSoraBackgroundTuning, readStoredTemperaTuning, readStoredTiltTuning, readStoredUrlBackgroundList, readStoredUrlBackgroundSelectedId, readStoredVisualizerBackgroundMode, readStoredVisualizerFrameRate, readStoredVisualizerMode, readStoredVisualizerOpacity, readStoredWallpaperOverlayAllApps, readStoredWallpaperOverlayEnabled, readStoredWallpaperOverlayHideCoverArt, readStoredWallpaperOverlayLockScreen, readStoredWallpaperOverlayLockScreenOnly, readStoredWallpaperOverlayHideNativeLyrics, readStoredWallpaperOverlayHideNativeProgress, readStoredWallpaperOverlayHideAfterLyricsEnd, readStoredWallpaperOverlayHideWhenPaused, readStoredWallpaperFloatingOpacity, readStoredWallpaperFloatingOffsetX, readStoredWallpaperFloatingFontSize, readStoredWallpaperFloatingFontSizeMode,
readStoredWallpaperFloatingFillSafeArea, readStoredWallpaperFloatingAvoidWidth, readStoredWallpaperFloatingAvoidOffsetX,
readStoredWallpaperLyricsFontMode,
readStoredWallpaperFloatingWidth,
readStoredWallpaperFloatingOverSafeArea, readStoredWallpaperOverlayOpacity, readStoredWallpaperOverlaySkipInstrumental, resolveCappellaAvatarSource, resolveFumeCameraTrackingMode, resolvePendoloNumber, resolveStoredDioramaTuning, resolveStoredLatentBackgroundTuning, resolveStoredMonetBackgroundTuning, resolveStoredMonetTuning, resolveStoredNomandBackgroundTuning, resolveStoredSoraBackgroundTuning, sanitizeTemperaLayerImages } from './visualizerSettingsPersistence';
import { getStoredBoolean, getStoredString, setStoredBoolean, setStoredString } from './storagePrimitives';

/** 是否把播放中的歌词喂给系统动态壁纸。关掉后壁纸保留最后一帧，不再更新。 */
export const LYRICS_WALLPAPER_FEED_STORAGE_KEY = 'folia.lyricsWallpaperFeed';

/*
 * 注意函数体要和返回类型一起改：加了 'video' 这一支类型、**没**加这个判断的话，
 * 存进去的 'video' 在**下一次读存储**时就会被静默回退成 'cover' ——
 * 用户看到的就是「设了视频背景，动一下别的设置又变回封面」。
 * （读存储不只在启动时发生：叠层那份页面每次重载都会重新读一遍 localStorage。）
 */
const resolveWallpaperBackground = (value: string): 'cover' | 'color' | 'image' | 'video' =>
    value === 'color' || value === 'image' || value === 'video' ? value : 'cover';
/** 歌词壁纸的背景：模糊封面 / 主题色渐变 / 自选图片。 */
export const LYRICS_WALLPAPER_BACKGROUND_STORAGE_KEY = 'folia.lyricsWallpaperBackground';
/** 歌词壁纸的自选背景图（base64，已压到 512px）。体积不小，但落 localStorage 仍在配额内。 */
export const LYRICS_WALLPAPER_IMAGE_STORAGE_KEY = 'folia.lyricsWallpaperImage';
/** 歌词壁纸的背景模糊强度 0..1。0 = 完全清晰，1 = 糊到只剩色块。 */
export const LYRICS_WALLPAPER_BLUR_STORAGE_KEY = 'folia.lyricsWallpaperBlur';
/** 歌词壁纸顶部下方那条整首歌的进度条。 */
export const LYRICS_WALLPAPER_PROGRESS_STORAGE_KEY = 'folia.lyricsWallpaperProgress';
/** 歌词壁纸的双行翻译：主行下面再挂一行翻译。 */
export const LYRICS_WALLPAPER_TRANSLATION_STORAGE_KEY = 'folia.lyricsWallpaperTranslation';
/** 歌词壁纸的样式：'minimal' 固定精简风格，'follow' 跟随播放页选的可视化模式。 */
export const LYRICS_WALLPAPER_STYLE_STORAGE_KEY = 'folia.lyricsWallpaperStyle';

// 默认偏轻：多数人选图就是想看清那张图，糊过头反而违背意图。想要柔化往上拉即可。
const DEFAULT_WALLPAPER_BLUR = 0.35;

const clampWallpaperBlur = (value: number): number => {
    if (!Number.isFinite(value)) return DEFAULT_WALLPAPER_BLUR;
    return Math.min(1, Math.max(0, value));
};
import { useVisualizerAssetStore } from './useVisualizerAssetStore';
import { normalizeLumiereTuning } from '../utils/lumiereTuning';

export type VisualizerSettingsState = {
    disableVisualizerVignette: boolean;
    disableVisualizerGeometricBackground: boolean;
    backgroundOpacity: number;
    visualizerOpacity: number;
    visualizerBackgroundMode: VisualizerBackgroundMode | null;
    urlBackgroundList: UrlBackgroundItem[];
    urlBackgroundSelectedId: string | null;
    visualizerFrameRate: VisualizerFrameRate;
    /**
     * 画布渲染分辨率的上限，null = 跟随屏幕。
     *
     * 存的是用户「想要的上限」，不是生效值：屏幕只有 1× 时选 2× 什么都不会变，库里的值仍然是 2×，
     * 换到高分屏上才生效。见 utils/renderPixelRatio.ts。
     */
    renderPixelRatio: RenderPixelRatio | null;
    visualizerMode: VisualizerMode;
    randomVisualizerModePerSong: boolean;
    /** Snap animated glow blur radii to a bounded set. See components/visualizer/wordGlow.ts. */
    glowBlurQuantize: boolean;
    /** 把播放中的歌词推给原生歌词动态壁纸。Android 专有，其它平台恒为 false 也不影响。 */
    lyricsWallpaperFeed: boolean;
    /** 歌词壁纸的背景：'cover' 模糊封面，'color' 主题色渐变，'image' 自选图片。 */
    lyricsWallpaperBackground: 'cover' | 'color' | 'image' | 'video';
    /** 自选背景图的 base64，lyricsWallpaperBackground='image' 时生效。 */
    lyricsWallpaperImage: string | null;
    /** 背景模糊强度 0..1：同时作用于模糊封面与自选背景图。 */
    lyricsWallpaperBlur: number;
    /** 是否在歌词区顶部下方显示整首歌的进度条。 */
    lyricsWallpaperProgress: boolean;
    /** 桌面歌词是否在主行下面再挂一行翻译。歌词本身没翻译时不会因此多出空行。 */
    lyricsWallpaperTranslation: boolean;
    /** 壁纸样式：'minimal' 固定精简风格，'follow' 跟随播放页的可视化模式。 */
    lyricsWallpaperStyle: 'minimal' | 'follow';
    /** 可视化叠层总开关。关掉之后一层都不挂。 */
    wallpaperOverlayEnabled: boolean;
    /** 音乐锁屏：锁屏界面上也挂叠层（画面与桌面叠层完全一致）。 */
    wallpaperOverlayLockScreen: boolean;
    /** 叠层只在锁屏上出现：桌面 / 所有应用 / App 内一律不挂。 */
    wallpaperOverlayLockScreenOnly: boolean;
    /** 可视化叠层整体窗口的不透明度，0.1..1。 */
    wallpaperOverlayOpacity: number;
    /**
     * 「精简」样式那颗悬浮歌词小窗的底色不透明度，0.05..1。
     *
     * 单独一份：小窗是另一层系统窗口，底色的浓淡和壁纸那头、跟随样式那层 WebView
     * 叠层都无关，复用那两个滑条只会两头都对不上。
     */
    /**
     * 歌词字体的来路：'follow' = 跟随播放页那套，'custom' = 单独指定一个字体文件。
     *
     * 'custom' 才需要那个「选择字体」按钮 —— 'follow' 时选了也不该用
     * （见 persistence 里的说明：原生那两层拿不到播放页那个字体字节）。
     */
    wallpaperLyricsFontMode: 'follow' | 'custom';
    wallpaperFloatingOpacity: number;
    /**
     * 「精简」样式那颗小窗直接叠在安全区（状态栏那一条）上面。
     *
     * 打开之后小窗贴在屏幕最顶上，高度方向不再参与摆放，只给左右 ——
     * 有人就是想让它压住状态栏那一条当「状态栏歌词」用，但不是所有人都接受挡住时间/电量，
     * 所以默认关。
     */
    wallpaperFloatingOverSafeArea: boolean;
    /**
     * 叠加安全区时小窗的左右位置，0 = 贴左，1 = 贴右。
     *
     * 只在这个开关打开时生效，而且只是**初值**：原生那边拖过之后记的是拖出来的比例，
     * 这里再改一次会覆盖回去（原生拿它当设置值而不是当前值）。
     */
    wallpaperFloatingOffsetX: number;
    /**
     * 叠加安全区时小窗占屏幕宽度的比例，0.5..1。
     *
     * 它是屏幕宽度的比例而不是像素：这个模式要的是「占住状态栏这一条的多宽」，
     * 百分比比像素直观，换台设备也不会变样。
     */
    wallpaperFloatingWidth: number;
    /**
     * 叠加安全区时直接**占满整条**（左右不再留空）。
     *
     * 打开后上面那两根（左右位置、宽度）都不参与 —— 整条都要了，没有位置可言。
     * 非竖屏时原生那边不认这一条，自动退回宽度滑条给的宽（转回来又占满）。
     */
    wallpaperFloatingFillSafeArea: boolean;
    /**
     * 占满时留出的「避开区域」宽度（占整条宽的比例），0..0.5。0 = 不避让。
     *
     * 挖孔 / 刘海那一条上字压上去就像被切了一块，而各家 ROM 都不往外报挖孔在哪，
     * 只能让用户自己指。字是**绕过去**的（洞左半继续、右半接着），不是被裁掉。
     */
    wallpaperFloatingAvoidWidth: number;
    /** 避开区域的左右位置，0 = 贴左，1 = 贴右。只在上面的宽度大于 0 时有意义。 */
    wallpaperFloatingAvoidOffsetX: number;
    /**
     * 设置页正开着 → 原生那层小窗即使在 App 里也挂出来（预览）。不持久化。
     *
     * 没有它，「实时预览」这几根滑条是空的：正常逻辑在 App 里不挂这一层，
     * 而调设置恰恰是在 App 里做的 —— 拖到底也看不见任何东西。
     */
    wallpaperFloatingPreview: boolean;
    /**
     * 悬浮小窗的字号模式：'dynamic' = 跟着窗口高度算，'custom' = 自己指定。
     *
     * 默认 dynamic —— 拖大窗口字就跟着大，对多数人够用。custom 是给「就想让字小一点」
     * 和叠加模式（窗口只有状态栏那么高，算出来的字号小到看不清）留的。
     */
    wallpaperFloatingFontSizeMode: 'dynamic' | 'custom';
    /** 自定义模式的字号（dp），10..32。只在上面那个模式为 'custom' 时生效。 */
    wallpaperFloatingFontSize: number;
    /** 叠层是否在所有应用之上显示。关掉时只在桌面（壁纸可见）时挂着。 */
    wallpaperOverlayAllApps: boolean;
    /** 跟随 + 叠层时，隐藏原生那层歌词，避免和可视化的歌词叠在一起。 */
    wallpaperOverlayHideNativeLyrics: boolean;
    /** 跟随 + 叠层时，隐藏原生那层的进度条。 */
    wallpaperOverlayHideNativeProgress: boolean;
    /** 纯音乐（没有歌词）时不显示叠层。 */
    wallpaperOverlaySkipInstrumental: boolean;
    /** 暂停时自动隐藏叠层。 */
    wallpaperOverlayHideWhenPaused: boolean;
    /** 歌词唱完之后自动隐藏叠层。 */
    wallpaperOverlayHideAfterLyricsEnd: boolean;
    /**
     * 桌面叠层里隐藏封面。
     *
     * 封面是一整块不透明的方形图，挂在叠层上就把底下的原生壁纸糊掉一大块 ——
     * 而叠层存在的意义恰恰是透出壁纸，所以默认隐藏，想要完整构图的再打开。
     */
    wallpaperOverlayHideCoverArt: boolean;
    classicTuning: ClassicTuning;
    cadenzaTuning: CadenzaTuning;
    partitaTuning: PartitaTuning;
    fumeTuning: FumeTuning;
    claddaghTuning: CladdaghTuning;
    cappellaTuning: CappellaTuning;
    tiltTuning: TiltTuning;
    dioramaTuning: DioramaTuning;
    monetBackgroundTuning: MonetBackgroundTuning;
    nomandBackgroundTuning: NomandBackgroundTuning;
    latentBackgroundTuning: LatentBackgroundTuning;
    soraBackgroundTuning: SoraBackgroundTuning;
    monetTuning: MonetTuning;
    pendoloTuning: PendoloTuning;
    sonnetTuning: SonnetTuning;
    temperaTuning: TemperaTuning;
    lumiereTuning: LumiereTuning;
    handleToggleDisableVisualizerVignette: (disable: boolean) => void;
    handleToggleDisableVisualizerGeometricBackground: (disable: boolean) => void;
    handleSetBackgroundOpacity: (opacity: number) => void;
    handleSetVisualizerOpacity: (opacity: number) => void;
    handleSetVisualizerBackgroundMode: (mode: VisualizerBackgroundMode) => void;
    handleResetVisualizerBackgroundMode: () => void;
    handleAddUrlBackgroundItem: (item: UrlBackgroundItem) => void;
    handleUpdateUrlBackgroundItem: (id: string, patch: Partial<Omit<UrlBackgroundItem, 'id'>>) => void;
    handleDeleteUrlBackgroundItem: (id: string) => void;
    handleSetUrlBackgroundSelectedId: (id: string | null) => void;
    handleSetUrlBackgroundList: (items: UrlBackgroundItem[]) => void;
    handleSetVisualizerFrameRate: (frameRate: VisualizerFrameRate) => void;
    handleSetRenderPixelRatio: (limit: RenderPixelRatio | null) => void;
    handleSetVisualizerMode: (mode: VisualizerMode, options?: { notify?: boolean }) => void;
    handleToggleRandomVisualizerModePerSong: (enable: boolean) => void;
    handleToggleGlowBlurQuantize: (enable: boolean) => void;
    handleToggleLyricsWallpaperFeed: (enable: boolean) => void;
    handleSetLyricsWallpaperBackground: (mode: 'cover' | 'color' | 'image' | 'video') => void;
    handleSetLyricsWallpaperImage: (image: string | null) => void;
    handleSetLyricsWallpaperBlur: (blur: number) => void;
    handleToggleLyricsWallpaperProgress: (enable: boolean) => void;
    handleToggleLyricsWallpaperTranslation: (enable: boolean) => void;
    handleSetWallpaperOverlayOpacity: (value: number) => void;
    /** 「精简」样式那颗悬浮歌词小窗的底色不透明度。见 wallpaperFloatingOpacity 的说明。 */
    handleSetWallpaperFloatingOpacity: (value: number) => void;
    /** 小窗叠在安全区上面。见 wallpaperFloatingOverSafeArea 的说明。 */
    handleToggleWallpaperFloatingOverSafeArea: (enable: boolean) => void;
    /** 叠加模式下小窗的左右位置。见 wallpaperFloatingOffsetX 的说明。 */
    handleSetWallpaperFloatingOffsetX: (value: number) => void;
    /** 叠加模式下小窗的宽度（屏幕宽度比例）。见 wallpaperFloatingWidth 的说明。 */
    handleSetWallpaperFloatingWidth: (value: number) => void;
    /** 占满整条安全区。见 wallpaperFloatingFillSafeArea 的说明。 */
    handleToggleWallpaperFloatingFillSafeArea: (enable: boolean) => void;
    /** 避开区域的宽度（整条宽的比例）。见 wallpaperFloatingAvoidWidth 的说明。 */
    handleSetWallpaperFloatingAvoidWidth: (value: number) => void;
    /** 避开区域的左右位置。见 wallpaperFloatingAvoidOffsetX 的说明。 */
    handleSetWallpaperFloatingAvoidOffsetX: (value: number) => void;
    /**
     * 设置页正开着（预览）。**不落盘** —— 它是「此刻在看不在看」，不是偏好。
     *
     * 页面挂载 / 卸载时由设置页自己拨，关掉之后下一次启动不该还挂在那儿。
     */
    handleSetWallpaperFloatingPreview: (enable: boolean) => void;
    /** 歌词字体来路。见 wallpaperLyricsFontMode 的说明。 */
    handleSetWallpaperLyricsFontMode: (mode: 'follow' | 'custom') => void;
    handleSetWallpaperFloatingFontSizeMode: (mode: 'dynamic' | 'custom') => void;
    /** 自定义字号（dp）。见 wallpaperFloatingFontSize 的说明。 */
    handleSetWallpaperFloatingFontSize: (value: number) => void;
    handleToggleWallpaperOverlayEnabled: (enable: boolean) => void;
    handleToggleWallpaperOverlayLockScreen: (enable: boolean) => void;
    handleToggleWallpaperOverlayLockScreenOnly: (enable: boolean) => void;
    handleToggleWallpaperOverlayAllApps: (enable: boolean) => void;
    handleToggleWallpaperOverlayHideNativeLyrics: (enable: boolean) => void;
    handleToggleWallpaperOverlayHideNativeProgress: (enable: boolean) => void;
    handleToggleWallpaperOverlaySkipInstrumental: (enable: boolean) => void;
    handleToggleWallpaperOverlayHideWhenPaused: (enable: boolean) => void;
    handleToggleWallpaperOverlayHideAfterLyricsEnd: (enable: boolean) => void;
    handleToggleWallpaperOverlayHideCoverArt: (enable: boolean) => void;
    handleSetLyricsWallpaperStyle: (style: 'minimal' | 'follow') => void;
    handleSetClassicTuning: (patch: Partial<ClassicTuning>) => void;
    handleResetClassicTuning: () => void;
    handleSetCadenzaTuning: (patch: Partial<CadenzaTuning>) => void;
    handleResetCadenzaTuning: () => void;
    handleSetPartitaTuning: (patch: Partial<PartitaTuning>) => void;
    handleResetPartitaTuning: () => void;
    handleSetFumeTuning: (patch: Partial<FumeTuning>) => void;
    handleResetFumeTuning: () => void;
    handleSetCladdaghTuning: (patch: Partial<CladdaghTuning>) => void;
    handleResetCladdaghTuning: () => void;
    handleSetCappellaTuning: (patch: Partial<CappellaTuning>) => void;
    handleResetCappellaTuning: () => void;
    handleSetTiltTuning: (patch: Partial<TiltTuning>) => void;
    handleResetTiltTuning: () => void;
    handleSetDioramaTuning: (patch: Partial<DioramaTuning>) => void;
    handleResetDioramaTuning: () => void;
    handleSetMonetBackgroundTuning: (patch: Partial<MonetBackgroundTuning>) => void;
    handleResetMonetBackgroundTuning: () => void;
    handleSetNomandBackgroundTuning: (patch: Partial<NomandBackgroundTuning>) => void;
    handleResetNomandBackgroundTuning: () => void;
    handleSetLatentBackgroundTuning: (patch: Partial<LatentBackgroundTuning>) => void;
    handleResetLatentBackgroundTuning: () => void;
    handleSetSoraBackgroundTuning: (patch: Partial<SoraBackgroundTuning>) => void;
    handleResetSoraBackgroundTuning: () => void;
    handleSetMonetTuning: (patch: Partial<MonetTuning>) => void;
    handleResetMonetTuning: () => void;
    handleSetPendoloTuning: (patch: Partial<PendoloTuning>) => void;
    handleResetPendoloTuning: () => void;
    handleSetSonnetTuning: (patch: Partial<SonnetTuning>) => void;
    handleResetSonnetTuning: () => void;
    handleSetTemperaTuning: (patch: Partial<TemperaTuning>) => void;
    handleResetTemperaTuning: () => void;
    handleSetLumiereTuning: (patch: Partial<LumiereTuning>) => void;
    handleResetLumiereTuning: () => void;
    handleUploadMonetBackgroundImage: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    handleClearMonetBackgroundImage: () => Promise<void>;
    handleUploadMonetPortraitImage: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    handleClearMonetPortraitImage: () => Promise<void>;
    handleImportCustomCappellaEmojiPack: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    handleClearCustomCappellaEmojiPack: () => Promise<void>;
    handleImportCustomCappellaAvatar: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    handleClearCustomCappellaAvatar: () => Promise<void>;
};

export const useVisualizerSettingsStore = create<VisualizerSettingsState>((set, get) => ({
    disableVisualizerVignette: getStoredBoolean('disable_visualizer_vignette', false),
    disableVisualizerGeometricBackground: getStoredBoolean('disable_visualizer_geometric_background', false),
    backgroundOpacity: readStoredBackgroundOpacity(),
    visualizerOpacity: readStoredVisualizerOpacity(),
    visualizerBackgroundMode: readStoredVisualizerBackgroundMode(),
    urlBackgroundList: readStoredUrlBackgroundList(),
    urlBackgroundSelectedId: readStoredUrlBackgroundSelectedId(),
    visualizerFrameRate: readStoredVisualizerFrameRate(),
    renderPixelRatio: readStoredRenderPixelRatio(),
    visualizerMode: readStoredVisualizerMode(),
    randomVisualizerModePerSong: getStoredBoolean('random_visualizer_mode_per_song', false),
    glowBlurQuantize: readStoredGlowBlurQuantize(),
    lyricsWallpaperFeed: getStoredBoolean(LYRICS_WALLPAPER_FEED_STORAGE_KEY, true),
    lyricsWallpaperBackground: resolveWallpaperBackground(
        getStoredString(LYRICS_WALLPAPER_BACKGROUND_STORAGE_KEY, 'cover')),
    lyricsWallpaperImage: getStoredString(LYRICS_WALLPAPER_IMAGE_STORAGE_KEY, '') || null,
    lyricsWallpaperBlur: clampWallpaperBlur(Number(getStoredString(LYRICS_WALLPAPER_BLUR_STORAGE_KEY, ''))),
    lyricsWallpaperProgress: getStoredBoolean(LYRICS_WALLPAPER_PROGRESS_STORAGE_KEY, true),
    lyricsWallpaperTranslation: getStoredBoolean(LYRICS_WALLPAPER_TRANSLATION_STORAGE_KEY, true),
    lyricsWallpaperStyle: getStoredString(LYRICS_WALLPAPER_STYLE_STORAGE_KEY, 'follow') === 'minimal'
        ? 'minimal'
        : 'follow',
    wallpaperOverlayEnabled: readStoredWallpaperOverlayEnabled(),
    wallpaperOverlayLockScreen: readStoredWallpaperOverlayLockScreen(),
    wallpaperOverlayLockScreenOnly: readStoredWallpaperOverlayLockScreenOnly(),
    wallpaperOverlayOpacity: readStoredWallpaperOverlayOpacity(),
    wallpaperLyricsFontMode: readStoredWallpaperLyricsFontMode(),
    wallpaperFloatingOpacity: readStoredWallpaperFloatingOpacity(),
    wallpaperFloatingOverSafeArea: readStoredWallpaperFloatingOverSafeArea(),
    wallpaperFloatingOffsetX: readStoredWallpaperFloatingOffsetX(),
    wallpaperFloatingWidth: readStoredWallpaperFloatingWidth(),
    wallpaperFloatingFillSafeArea: readStoredWallpaperFloatingFillSafeArea(),
    wallpaperFloatingAvoidWidth: readStoredWallpaperFloatingAvoidWidth(),
    wallpaperFloatingAvoidOffsetX: readStoredWallpaperFloatingAvoidOffsetX(),
    // 预览不读存储：它是「此刻在不在设置页」，不是用户偏好。
    wallpaperFloatingPreview: false,
    wallpaperFloatingFontSizeMode: readStoredWallpaperFloatingFontSizeMode(),
    wallpaperFloatingFontSize: readStoredWallpaperFloatingFontSize(),
    wallpaperOverlayAllApps: readStoredWallpaperOverlayAllApps(),
    wallpaperOverlayHideNativeLyrics: readStoredWallpaperOverlayHideNativeLyrics(),
    wallpaperOverlayHideNativeProgress: readStoredWallpaperOverlayHideNativeProgress(),
    wallpaperOverlaySkipInstrumental: readStoredWallpaperOverlaySkipInstrumental(),
    wallpaperOverlayHideWhenPaused: readStoredWallpaperOverlayHideWhenPaused(),
    wallpaperOverlayHideAfterLyricsEnd: readStoredWallpaperOverlayHideAfterLyricsEnd(),
    wallpaperOverlayHideCoverArt: readStoredWallpaperOverlayHideCoverArt(),
    classicTuning: readStoredClassicTuning(),
    cadenzaTuning: readStoredCadenzaTuning(),
    partitaTuning: readStoredPartitaTuning(),
    fumeTuning: readStoredFumeTuning(),
    claddaghTuning: readStoredCladdaghTuning(),
    cappellaTuning: readStoredCappellaTuning(),
    tiltTuning: readStoredTiltTuning(),
    dioramaTuning: readStoredDioramaTuning(),
    monetBackgroundTuning: readStoredMonetBackgroundTuning(),
    nomandBackgroundTuning: readStoredNomandBackgroundTuning(),
    latentBackgroundTuning: readStoredLatentBackgroundTuning(),
    soraBackgroundTuning: readStoredSoraBackgroundTuning(),
    monetTuning: readStoredMonetTuning(),
    pendoloTuning: readStoredPendoloTuning(),
    sonnetTuning: readStoredSonnetTuning(),
    temperaTuning: readStoredTemperaTuning(),
    lumiereTuning: readStoredLumiereTuning(),
    handleToggleDisableVisualizerVignette: (disable) => {
        setStoredBoolean('disable_visualizer_vignette', disable);
        set({ disableVisualizerVignette: disable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (disable ? 'vignetteOff' : 'vignetteOn')),
        });
    },
    handleToggleDisableVisualizerGeometricBackground: (disable) => {
        setStoredBoolean('disable_visualizer_geometric_background', disable);
        set({ disableVisualizerGeometricBackground: disable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (disable ? 'geometricBgHidden' : 'geometricBgShown')),
        });
    },
    handleSetBackgroundOpacity: (opacity) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('background_opacity', String(opacity));
        }
        set({ backgroundOpacity: opacity });
    },
    handleSetVisualizerOpacity: (opacity) => {
        const next = Math.min(1, Math.max(0.2, opacity));
        if (typeof window !== 'undefined') {
            localStorage.setItem(VISUALIZER_OPACITY_STORAGE_KEY, String(next));
        }
        set({ visualizerOpacity: next });
    },
    handleSetVisualizerBackgroundMode: (mode) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('visualizer_background_mode', mode);
        }
        set({ visualizerBackgroundMode: mode });
    },
    handleResetVisualizerBackgroundMode: () => {
        if (typeof window !== 'undefined') {
            localStorage.removeItem('visualizer_background_mode');
        }
        set({ visualizerBackgroundMode: null });
    },
    handleAddUrlBackgroundItem: (item) => {
        const sanitized = sanitizeUrlBackgroundItem(item);
        if (!sanitized) return;
        const next = [...get().urlBackgroundList, sanitized];
        if (typeof window !== 'undefined') {
            localStorage.setItem('url_background_list', JSON.stringify(next));
        }
        set({ urlBackgroundList: next });
    },
    handleUpdateUrlBackgroundItem: (id, patch) => {
        const next = get().urlBackgroundList.map(item =>
            item.id === id ? sanitizeUrlBackgroundItem({ ...item, ...patch, id: item.id }) ?? item : item
        );
        if (typeof window !== 'undefined') {
            localStorage.setItem('url_background_list', JSON.stringify(next));
        }
        set({ urlBackgroundList: next });
    },
    handleDeleteUrlBackgroundItem: (id) => {
        const next = get().urlBackgroundList.filter(item => item.id !== id);
        if (typeof window !== 'undefined') {
            localStorage.setItem('url_background_list', JSON.stringify(next));
        }
        const selectedId = get().urlBackgroundSelectedId;
        if (selectedId === id) {
            const newSelectedId = next.length > 0 ? next[0].id : null;
            if (typeof window !== 'undefined') {
                if (newSelectedId) {
                    localStorage.setItem('url_background_selected_id', newSelectedId);
                } else {
                    localStorage.removeItem('url_background_selected_id');
                }
            }
            set({ urlBackgroundList: next, urlBackgroundSelectedId: newSelectedId });
        } else {
            set({ urlBackgroundList: next });
        }
    },
    handleSetUrlBackgroundSelectedId: (id) => {
        if (typeof window !== 'undefined') {
            if (id) {
                localStorage.setItem('url_background_selected_id', id);
            } else {
                localStorage.removeItem('url_background_selected_id');
            }
        }
        set({ urlBackgroundSelectedId: id });
    },
    handleSetUrlBackgroundList: (items) => {
        const next = sanitizeUrlBackgroundList(items);
        const selectedId = get().urlBackgroundSelectedId;
        const nextSelectedId = selectedId && next.some(item => item.id === selectedId) ? selectedId : null;
        if (typeof window !== 'undefined') {
            localStorage.setItem('url_background_list', JSON.stringify(next));
            if (nextSelectedId) {
                localStorage.setItem('url_background_selected_id', nextSelectedId);
            } else {
                localStorage.removeItem('url_background_selected_id');
            }
        }
        set({ urlBackgroundList: next, urlBackgroundSelectedId: nextSelectedId });
    },
    handleSetVisualizerFrameRate: (frameRate) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(VISUALIZER_FRAME_RATE_STORAGE_KEY, String(frameRate));
        }
        setGlobalVisualizerFrameRate(frameRate);
        set({ visualizerFrameRate: frameRate });
    },
    handleSetRenderPixelRatio: (limit) => {
        if (typeof window !== 'undefined') {
            if (limit === null) {
                localStorage.removeItem(RENDER_PIXEL_RATIO_STORAGE_KEY);
            } else {
                localStorage.setItem(RENDER_PIXEL_RATIO_STORAGE_KEY, String(limit));
            }
        }
        setGlobalRenderPixelRatio(limit);
        set({ renderPixelRatio: limit });
    },
    handleSetVisualizerMode: (mode, options) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('visualizer_mode', mode);
        }
        set({ visualizerMode: mode });
        if (options?.notify !== false) {
            setStatusMessage({
                type: 'info',
                text: i18n.t('notifications.visualizerSwitched', {
                    mode: getVisualizerModeLabel(mode, key => i18n.t(key)),
                }),
            });
        }
    },
    handleToggleRandomVisualizerModePerSong: (enable) => {
        setStoredBoolean('random_visualizer_mode_per_song', enable);
        set({ randomVisualizerModePerSong: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t(`status.randomVisualizerModePerSong${enable ? 'On' : 'Off'}`),
        });
    },
    handleToggleGlowBlurQuantize: (enable) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(GLOW_BLUR_QUANTIZE_STORAGE_KEY, String(enable));
        }
        // The renderers read the module flag every frame; the store only persists and drives the UI.
        setGlowBlurQuantized(enable);
        set({ glowBlurQuantize: enable });
    },
    handleToggleLyricsWallpaperFeed: (enable) => {
        setStoredBoolean(LYRICS_WALLPAPER_FEED_STORAGE_KEY, enable);
        set({ lyricsWallpaperFeed: enable });
    },
    handleSetLyricsWallpaperBackground: (mode) => {
        setStoredString(LYRICS_WALLPAPER_BACKGROUND_STORAGE_KEY, mode);
        set({ lyricsWallpaperBackground: mode });
    },
    handleSetLyricsWallpaperImage: (image) => {
        setStoredString(LYRICS_WALLPAPER_IMAGE_STORAGE_KEY, image || '');
        set({ lyricsWallpaperImage: image });
    },
    handleSetLyricsWallpaperBlur: (blur) => {
        const next = clampWallpaperBlur(blur);
        setStoredString(LYRICS_WALLPAPER_BLUR_STORAGE_KEY, String(next));
        set({ lyricsWallpaperBlur: next });
    },
    handleToggleLyricsWallpaperProgress: (enable) => {
        setStoredBoolean(LYRICS_WALLPAPER_PROGRESS_STORAGE_KEY, enable);
        set({ lyricsWallpaperProgress: enable });
    },
    handleToggleLyricsWallpaperTranslation: (enable) => {
        setStoredBoolean(LYRICS_WALLPAPER_TRANSLATION_STORAGE_KEY, enable);
        set({ lyricsWallpaperTranslation: enable });
    },
    handleSetLyricsWallpaperStyle: (style) => {
        setStoredString(LYRICS_WALLPAPER_STYLE_STORAGE_KEY, style);
        set({ lyricsWallpaperStyle: style });
    },
    handleSetWallpaperOverlayOpacity: (value) => {
        // 下限 0.1：0 等于整层看不见，用户会以为功能坏了。
        const clamped = Math.min(1, Math.max(0.1, value));
        localStorage.setItem(WALLPAPER_OVERLAY_OPACITY_STORAGE_KEY, String(clamped));
        set({ wallpaperOverlayOpacity: clamped });
    },
    handleSetWallpaperFloatingOpacity: (value) => {
        // 下限 0：要的就是「只有字、没有底」（见 persistence 那边的说明）。
        const clamped = Math.min(1, Math.max(0, value));
        localStorage.setItem(WALLPAPER_FLOATING_OPACITY_STORAGE_KEY, String(clamped));
        set({ wallpaperFloatingOpacity: clamped });
    },
    handleToggleWallpaperFloatingOverSafeArea: (enable) => {
        localStorage.setItem(
            WALLPAPER_FLOATING_OVER_SAFE_AREA_STORAGE_KEY, enable ? 'true' : 'false');
        set({ wallpaperFloatingOverSafeArea: enable });
    },
    handleSetWallpaperFloatingOffsetX: (value) => {
        const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
        localStorage.setItem(WALLPAPER_FLOATING_OFFSET_X_STORAGE_KEY, String(clamped));
        set({ wallpaperFloatingOffsetX: clamped });
    },
    handleSetWallpaperFloatingWidth: (value) => {
        // 下限 0.5：再窄的话一行歌词基本每句都要靠横向滚动才看得完。
        const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0.5, value)) : 0.8;
        localStorage.setItem(WALLPAPER_FLOATING_WIDTH_STORAGE_KEY, String(clamped));
        set({ wallpaperFloatingWidth: clamped });
    },
    handleToggleWallpaperFloatingFillSafeArea: (enable) => {
        localStorage.setItem(
            WALLPAPER_FLOATING_FILL_SAFE_AREA_STORAGE_KEY, enable ? 'true' : 'false');
        set({ wallpaperFloatingFillSafeArea: enable });
    },
    handleSetWallpaperFloatingAvoidWidth: (value) => {
        // 上限 0.5：划掉一半以上就没什么地方画字了。0 = 不避让。
        const clamped = Number.isFinite(value) ? Math.min(0.5, Math.max(0, value)) : 0.12;
        localStorage.setItem(WALLPAPER_FLOATING_AVOID_WIDTH_STORAGE_KEY, String(clamped));
        set({ wallpaperFloatingAvoidWidth: clamped });
    },
    handleSetWallpaperFloatingAvoidOffsetX: (value) => {
        const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
        localStorage.setItem(WALLPAPER_FLOATING_AVOID_OFFSET_X_STORAGE_KEY, String(clamped));
        set({ wallpaperFloatingAvoidOffsetX: clamped });
    },
    handleSetWallpaperFloatingPreview: (enable) => {
        set({ wallpaperFloatingPreview: enable });
    },
    handleSetWallpaperLyricsFontMode: (mode) => {
        localStorage.setItem(WALLPAPER_LYRICS_FONT_MODE_STORAGE_KEY, mode);
        set({ wallpaperLyricsFontMode: mode });
    },
    handleSetWallpaperFloatingFontSizeMode: (mode) => {
        localStorage.setItem(WALLPAPER_FLOATING_FONT_SIZE_MODE_STORAGE_KEY, mode);
        set({ wallpaperFloatingFontSizeMode: mode });
    },
    handleSetWallpaperFloatingFontSize: (value) => {
        // 10~32dp：再小看不清，再大一行就装不下。
        const clamped = Number.isFinite(value) ? Math.min(32, Math.max(10, value)) : 14;
        localStorage.setItem(WALLPAPER_FLOATING_FONT_SIZE_STORAGE_KEY, String(clamped));
        set({ wallpaperFloatingFontSize: clamped });
    },
    handleToggleWallpaperOverlayEnabled: (enable) => {
        localStorage.setItem(WALLPAPER_OVERLAY_ENABLED_STORAGE_KEY, enable ? 'true' : 'false');
        set({ wallpaperOverlayEnabled: enable });
    },
    handleToggleWallpaperOverlayLockScreen: (enable) => {
        localStorage.setItem(WALLPAPER_OVERLAY_LOCK_SCREEN_STORAGE_KEY, enable ? 'true' : 'false');
        set({ wallpaperOverlayLockScreen: enable });
    },
    handleToggleWallpaperOverlayLockScreenOnly: (enable) => {
        localStorage.setItem(WALLPAPER_OVERLAY_LOCK_SCREEN_ONLY_STORAGE_KEY, enable ? 'true' : 'false');
        /*
         * 「只在锁屏显示」隐含着「锁屏上要显示」。
         *
         * 原生那边 lockScreenWanted() 已经把两个开关做了或运算（兜住了只发一个的情况），
         * 但这里还是要顺手把音乐锁屏打开：设置页上那一行显示的是关着的，
         * 用户会以为"只在锁屏显示"和"音乐锁屏"是两个互不相干的东西，
         * 关掉其中一个就莫名其妙没效果了。
         */
        if (enable) {
            localStorage.setItem(WALLPAPER_OVERLAY_LOCK_SCREEN_STORAGE_KEY, 'true');
            set({ wallpaperOverlayLockScreen: true });
        }
        set({ wallpaperOverlayLockScreenOnly: enable });
    },
    handleToggleWallpaperOverlayAllApps: (enable) => {
        localStorage.setItem(WALLPAPER_OVERLAY_ALL_APPS_STORAGE_KEY, enable ? 'true' : 'false');
        set({ wallpaperOverlayAllApps: enable });
    },
    handleToggleWallpaperOverlayHideNativeLyrics: (enable) => {
        localStorage.setItem(WALLPAPER_OVERLAY_HIDE_NATIVE_LYRICS_STORAGE_KEY, enable ? 'true' : 'false');
        set({ wallpaperOverlayHideNativeLyrics: enable });
    },
    handleToggleWallpaperOverlayHideNativeProgress: (enable) => {
        localStorage.setItem(WALLPAPER_OVERLAY_HIDE_NATIVE_PROGRESS_STORAGE_KEY, enable ? 'true' : 'false');
        set({ wallpaperOverlayHideNativeProgress: enable });
    },
    handleToggleWallpaperOverlaySkipInstrumental: (enable) => {
        localStorage.setItem(WALLPAPER_OVERLAY_SKIP_INSTRUMENTAL_STORAGE_KEY, enable ? 'true' : 'false');
        set({ wallpaperOverlaySkipInstrumental: enable });
    },
    handleToggleWallpaperOverlayHideWhenPaused: (enable) => {
        localStorage.setItem(WALLPAPER_OVERLAY_HIDE_WHEN_PAUSED_STORAGE_KEY, enable ? 'true' : 'false');
        set({ wallpaperOverlayHideWhenPaused: enable });
    },
    handleToggleWallpaperOverlayHideAfterLyricsEnd: (enable) => {
        localStorage.setItem(WALLPAPER_OVERLAY_HIDE_AFTER_LYRICS_END_STORAGE_KEY, enable ? 'true' : 'false');
        set({ wallpaperOverlayHideAfterLyricsEnd: enable });
    },
    handleToggleWallpaperOverlayHideCoverArt: (enable) => {
        localStorage.setItem(WALLPAPER_OVERLAY_HIDE_COVER_ART_STORAGE_KEY, enable ? 'true' : 'false');
        set({ wallpaperOverlayHideCoverArt: enable });
    },
    handleSetClassicTuning: (patch) => {
        const prev = get().classicTuning;
        const next = {
            enableWordRotation: patch.enableWordRotation ?? prev.enableWordRotation,
            breathingFloatMultiplier: clampClassicBreathingFloatMultiplier(
                patch.breathingFloatMultiplier ?? prev.breathingFloatMultiplier,
                prev.breathingFloatMultiplier,
            ),
            useLegacyLayout: patch.useLegacyLayout ?? prev.useLegacyLayout,
            wordSpacing: clampClassicWordSpacing(
                patch.wordSpacing ?? prev.wordSpacing ?? DEFAULT_CLASSIC_TUNING.wordSpacing ?? 0.7,
                prev.wordSpacing ?? DEFAULT_CLASSIC_TUNING.wordSpacing ?? 0.7,
            ),
        };
        if (typeof window !== 'undefined') {
            localStorage.setItem('classic_tuning', JSON.stringify(next));
        }
        set({ classicTuning: next });
    },
    handleResetClassicTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('classic_tuning', JSON.stringify(DEFAULT_CLASSIC_TUNING));
        }
        set({ classicTuning: DEFAULT_CLASSIC_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.classicReset') });
    },
    handleSetCadenzaTuning: (patch) => {
        const next = { ...get().cadenzaTuning, ...patch, beamIntensity: 0 };
        if (typeof window !== 'undefined') {
            localStorage.setItem('cadenza_tuning', JSON.stringify(next));
        }
        set({ cadenzaTuning: next });
    },
    handleResetCadenzaTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('cadenza_tuning', JSON.stringify(DEFAULT_CADENZA_TUNING));
        }
        set({ cadenzaTuning: DEFAULT_CADENZA_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.cadenzaReset') });
    },
    handleSetPartitaTuning: (patch) => {
        const prev = get().partitaTuning;
        const rawMin = clampPartitaStagger(patch.staggerMin ?? prev.staggerMin, prev.staggerMin);
        const rawMax = clampPartitaStagger(patch.staggerMax ?? prev.staggerMax, prev.staggerMax);
        const next = {
            showGuideLines: patch.showGuideLines ?? prev.showGuideLines,
            useSemanticLayout: patch.useSemanticLayout ?? prev.useSemanticLayout,
            staggerMin: Math.min(rawMin, rawMax),
            staggerMax: Math.max(rawMin, rawMax),
        };
        if (typeof window !== 'undefined') {
            localStorage.setItem('partita_tuning', JSON.stringify(next));
        }
        set({ partitaTuning: next });
    },
    handleResetPartitaTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('partita_tuning', JSON.stringify(DEFAULT_PARTITA_TUNING));
        }
        set({ partitaTuning: DEFAULT_PARTITA_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.partitaReset') });
    },
    handleSetFumeTuning: (patch) => {
        const prev = get().fumeTuning;
        const next = {
            hidePrintSymbols: patch.hidePrintSymbols ?? prev.hidePrintSymbols,
            disableGeometricBackground: patch.disableGeometricBackground ?? prev.disableGeometricBackground,
            backgroundObjectOpacity: clampFumeBackgroundObjectOpacity(
                patch.backgroundObjectOpacity ?? prev.backgroundObjectOpacity,
                prev.backgroundObjectOpacity,
            ),
            textHoldRatio: clampFumeTextHoldRatio(patch.textHoldRatio ?? prev.textHoldRatio, prev.textHoldRatio),
            cameraTrackingMode: resolveFumeCameraTrackingMode(patch.cameraTrackingMode ?? prev.cameraTrackingMode),
            cameraSpeed: clampFumeCameraSpeed(patch.cameraSpeed ?? prev.cameraSpeed, prev.cameraSpeed),
            glowIntensity: clampFumeGlowIntensity(patch.glowIntensity ?? prev.glowIntensity, prev.glowIntensity),
            heroScale: clampFumeHeroScale(patch.heroScale ?? prev.heroScale, prev.heroScale),
        };
        if (typeof window !== 'undefined') {
            localStorage.setItem('fume_tuning', JSON.stringify(next));
        }
        set({ fumeTuning: next });
    },
    handleResetFumeTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('fume_tuning', JSON.stringify(DEFAULT_FUME_TUNING));
        }
        set({ fumeTuning: DEFAULT_FUME_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.fumeReset') });
    },
    handleSetCladdaghTuning: (patch) => {
        const prev = get().claddaghTuning;
        const next = {
            focusScaleRatio: clampCladdaghFocusScaleRatio(patch.focusScaleRatio ?? prev.focusScaleRatio, prev.focusScaleRatio),
            radiusScale: clampCladdaghRadiusScale(patch.radiusScale ?? prev.radiusScale, prev.radiusScale),
            ellipseTiltDeg: clampCladdaghEllipseTiltDeg(patch.ellipseTiltDeg ?? prev.ellipseTiltDeg, prev.ellipseTiltDeg),
            showAxisLine: patch.showAxisLine ?? prev.showAxisLine,
            letterSpacingOffset: clampCladdaghLetterSpacingOffset(patch.letterSpacingOffset ?? prev.letterSpacingOffset, prev.letterSpacingOffset),
        };
        if (typeof window !== 'undefined') {
            localStorage.setItem('claddagh_tuning', JSON.stringify(next));
        }
        set({ claddaghTuning: next });
    },
    handleResetCladdaghTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('claddagh_tuning', JSON.stringify(DEFAULT_CLADDAGH_TUNING));
        }
        set({ claddaghTuning: DEFAULT_CLADDAGH_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.claddaghReset') });
    },
    handleSetPendoloTuning: (patch: Partial<PendoloTuning>) => {
        const prev = get().pendoloTuning;
        const next: PendoloTuning = {
            arcRadius: resolvePendoloNumber(patch.arcRadius, prev.arcRadius, 0.25, 0.80),
            arcAngleDeg: resolvePendoloNumber(patch.arcAngleDeg, prev.arcAngleDeg, 40, 160),
            wheelCenterX: resolvePendoloNumber(patch.wheelCenterX, prev.wheelCenterX, -0.30, 0.50),
            wheelCenterY: resolvePendoloNumber(patch.wheelCenterY, prev.wheelCenterY, 0.20, 0.80),
            tickSnappiness: resolvePendoloNumber(patch.tickSnappiness, prev.tickSnappiness, 0.5, 2.0),
            activeScale: resolvePendoloNumber(patch.activeScale, prev.activeScale, 1.00, 1.60),
            showGearDecor: patch.showGearDecor === 'none' || patch.showGearDecor === 'subtle' || patch.showGearDecor === 'full'
                ? patch.showGearDecor
                : prev.showGearDecor,
            showCenterGradient: typeof patch.showCenterGradient === 'boolean'
                ? patch.showCenterGradient
                : prev.showCenterGradient ?? DEFAULT_PENDOLO_TUNING.showCenterGradient,
            showCoverOnWatchFace: typeof patch.showCoverOnWatchFace === 'boolean'
                ? patch.showCoverOnWatchFace
                : prev.showCoverOnWatchFace ?? DEFAULT_PENDOLO_TUNING.showCoverOnWatchFace,
            enableLineGlow: typeof patch.enableLineGlow === 'boolean'
                ? patch.enableLineGlow
                : prev.enableLineGlow ?? DEFAULT_PENDOLO_TUNING.enableLineGlow,
        };
        if (typeof window !== 'undefined') {
            localStorage.setItem('pendolo_tuning', JSON.stringify(next));
        }
        set({ pendoloTuning: next });
    },
    handleResetPendoloTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('pendolo_tuning', JSON.stringify(DEFAULT_PENDOLO_TUNING));
        }
        set({ pendoloTuning: DEFAULT_PENDOLO_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.pendoloReset') });
    },
    handleSetSonnetTuning: (patch: Partial<SonnetTuning>) => {
        const prev = get().sonnetTuning;
        const next: SonnetTuning = {
            // 上限就是默认值（见 SONNET_CAMERA_INTENSITY_MAX）：镜头运动再高会把画面甩出屏幕外。
            cameraIntensity: resolvePendoloNumber(
                patch.cameraIntensity,
                prev.cameraIntensity,
                0,
                SONNET_CAMERA_INTENSITY_MAX,
            ),
            typographyMotion: resolvePendoloNumber(patch.typographyMotion, prev.typographyMotion, 0, 2),
            mgDensity: resolvePendoloNumber(patch.mgDensity, prev.mgDensity, 0, 2),
            showOnlyText: typeof patch.showOnlyText === 'boolean' ? patch.showOnlyText : prev.showOnlyText,
            showGuide: typeof patch.showGuide === 'boolean' ? patch.showGuide : prev.showGuide,
            showBackgroundMg: typeof patch.showBackgroundMg === 'boolean' ? patch.showBackgroundMg : prev.showBackgroundMg,
            showFixedGeo: typeof patch.showFixedGeo === 'boolean' ? patch.showFixedGeo : prev.showFixedGeo,
            showGiantDecorativeText: typeof patch.showGiantDecorativeText === 'boolean'
                ? patch.showGiantDecorativeText
                : prev.showGiantDecorativeText,
            showBackgroundDecor: typeof patch.showBackgroundDecor === 'boolean'
                ? patch.showBackgroundDecor
                : prev.showBackgroundDecor,
            enableTransitions: typeof patch.enableTransitions === 'boolean'
                ? patch.enableTransitions
                : prev.enableTransitions,
            outerFrameMode: patch.outerFrameMode === 'none'
                || patch.outerFrameMode === 'frame'
                || patch.outerFrameMode === 'full'
                ? patch.outerFrameMode
                : prev.outerFrameMode,
            textureResolution: resolvePendoloNumber(patch.textureResolution, prev.textureResolution, 0.5, 4),
            postProcessEnabled: typeof patch.postProcessEnabled === 'boolean'
                ? patch.postProcessEnabled
                : prev.postProcessEnabled,
            postProcessGrain: resolvePendoloNumber(patch.postProcessGrain, prev.postProcessGrain, 0, 1),
            postProcessContrast: resolvePendoloNumber(patch.postProcessContrast, prev.postProcessContrast, 0, 1),
            postProcessRgbShift: resolvePendoloNumber(patch.postProcessRgbShift, prev.postProcessRgbShift, 0, 1),
            postProcessHalftone: resolvePendoloNumber(patch.postProcessHalftone, prev.postProcessHalftone, 0, 1),
            postProcessVignette: resolvePendoloNumber(patch.postProcessVignette, prev.postProcessVignette, 0, 2),
            postProcessLensDistortion: resolvePendoloNumber(patch.postProcessLensDistortion, prev.postProcessLensDistortion, 0, 2),
            postProcessLensDispersion: resolvePendoloNumber(patch.postProcessLensDispersion, prev.postProcessLensDispersion, 0, 1),
        };
        if (typeof window !== 'undefined') localStorage.setItem('sonnet_tuning', JSON.stringify(next));
        set({ sonnetTuning: next });
    },
    handleResetSonnetTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('sonnet_tuning', JSON.stringify(DEFAULT_SONNET_TUNING));
        }
        set({ sonnetTuning: DEFAULT_SONNET_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.sonnetReset') });
    },
    handleSetTemperaTuning: (patch: Partial<TemperaTuning>) => {
        const prev = get().temperaTuning;
        const next: TemperaTuning = {
            cameraIntensity: resolvePendoloNumber(patch.cameraIntensity, prev.cameraIntensity, 0, 2),
            glyphMotion: resolvePendoloNumber(patch.glyphMotion, prev.glyphMotion, 0, 2),
            wholeLineLyrics: typeof patch.wholeLineLyrics === 'boolean'
                ? patch.wholeLineLyrics
                : prev.wholeLineLyrics,
            glyphSettleStretch: resolvePendoloNumber(patch.glyphSettleStretch, prev.glyphSettleStretch, 0, 1),
            colorMode: patch.colorMode === 'duo' || patch.colorMode === 'mono' || patch.colorMode === 'gradient' ? patch.colorMode : prev.colorMode,
            textInversion: typeof patch.textInversion === 'boolean' ? patch.textInversion : prev.textInversion,
            layerImages: patch.layerImages ? sanitizeTemperaLayerImages(patch.layerImages) : prev.layerImages,
            layerImageDepth: patch.layerImageDepth === 'front' || patch.layerImageDepth === 'back' ? patch.layerImageDepth : prev.layerImageDepth,
            layerImageFrequency: patch.layerImageFrequency !== undefined ? clampUnit(patch.layerImageFrequency, prev.layerImageFrequency) : prev.layerImageFrequency,
            showBlocks: typeof patch.showBlocks === 'boolean' ? patch.showBlocks : prev.showBlocks,
            showDecor: typeof patch.showDecor === 'boolean' ? patch.showDecor : prev.showDecor,
            showCornerMarks: typeof patch.showCornerMarks === 'boolean' ? patch.showCornerMarks : prev.showCornerMarks,
            enableTransitions: typeof patch.enableTransitions === 'boolean'
                ? patch.enableTransitions
                : prev.enableTransitions,
            textureResolution: resolvePendoloNumber(patch.textureResolution, prev.textureResolution, 0.5, 4),
            postProcessEnabled: typeof patch.postProcessEnabled === 'boolean'
                ? patch.postProcessEnabled
                : prev.postProcessEnabled,
            postProcessTextureCompression: typeof patch.postProcessTextureCompression === 'boolean'
                ? patch.postProcessTextureCompression
                : prev.postProcessTextureCompression,
            postProcessGrain: resolvePendoloNumber(patch.postProcessGrain, prev.postProcessGrain, 0, 1),
            postProcessContrast: resolvePendoloNumber(patch.postProcessContrast, prev.postProcessContrast, 0, 1),
            postProcessRgbShift: resolvePendoloNumber(patch.postProcessRgbShift, prev.postProcessRgbShift, 0, 1),
            postProcessVignette: resolvePendoloNumber(patch.postProcessVignette, prev.postProcessVignette, 0, 2),
            postProcessLensDistortion: resolvePendoloNumber(patch.postProcessLensDistortion, prev.postProcessLensDistortion, 0, 2),
        };
        if (typeof window !== 'undefined') localStorage.setItem('tempera_tuning', JSON.stringify(next));
        set({ temperaTuning: next });
    },
    handleResetTemperaTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('tempera_tuning', JSON.stringify(DEFAULT_TEMPERA_TUNING));
        }
        set({ temperaTuning: DEFAULT_TEMPERA_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.temperaReset') });
    },
    handleSetLumiereTuning: (patch: Partial<LumiereTuning>) => {
        // Merge then normalize: the same clamp runs for slider drags, imports, sync and Folium.
        const next = normalizeLumiereTuning({ ...get().lumiereTuning, ...patch });
        if (typeof window !== 'undefined') localStorage.setItem(LUMIERE_TUNING_STORAGE_KEY, JSON.stringify(next));
        set({ lumiereTuning: next });
    },
    handleResetLumiereTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(LUMIERE_TUNING_STORAGE_KEY, JSON.stringify(DEFAULT_LUMIERE_TUNING));
        }
        set({ lumiereTuning: DEFAULT_LUMIERE_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.lumiereReset') });
    },
    handleSetCappellaTuning: (patch) => {
        const requestedCustomWithoutPack = patch.emojiPackSource === 'custom' && useVisualizerAssetStore.getState().storedCappellaEmojiPack.length === 0;
        if (requestedCustomWithoutPack) {
            setStatusMessage({ type: 'info', text: i18n.t('notifications.uploadEmojiFirst') });
        }

        const prev = get().cappellaTuning;
        const next = {
            showEmoMessages: patch.showEmoMessages ?? prev.showEmoMessages,
            emojiPackSource: patch.emojiPackSource === 'custom' && useVisualizerAssetStore.getState().storedCappellaEmojiPack.length === 0
                ? 'builtin' as const
                : (patch.emojiPackSource ?? prev.emojiPackSource),
            avatarSource: resolveCappellaAvatarSource(patch.avatarSource ?? prev.avatarSource),
        };
        if (typeof window !== 'undefined') {
            localStorage.setItem('cappella_tuning', JSON.stringify(next));
        }
        set({ cappellaTuning: next });
    },
    handleResetCappellaTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('cappella_tuning', JSON.stringify(DEFAULT_CAPPELLA_TUNING));
        }
        set({ cappellaTuning: DEFAULT_CAPPELLA_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.cappellaReset') });
    },
    handleSetTiltTuning: (patch) => {
        const prev = get().tiltTuning;
        const next = {
            splitProbability: Math.min(1, Math.max(0, patch.splitProbability ?? prev.splitProbability)),
            tiltStyleProbability: Math.min(1, Math.max(0, patch.tiltStyleProbability ?? prev.tiltStyleProbability)),
            colorScheme: patch.colorScheme ?? prev.colorScheme,
        };
        if (typeof window !== 'undefined') {
            localStorage.setItem('tilt_tuning', JSON.stringify(next));
        }
        set({ tiltTuning: next });
    },
    handleResetTiltTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('tilt_tuning', JSON.stringify(DEFAULT_TILT_TUNING));
        }
        set({ tiltTuning: DEFAULT_TILT_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.tiltReset') });
    },
    handleSetDioramaTuning: (patch) => {
        const prev = get().dioramaTuning;
        const next = resolveStoredDioramaTuning({
            ...prev,
            ...patch,
            geometryVisibility: patch.geometryVisibility
                ? { ...prev.geometryVisibility, ...patch.geometryVisibility }
                : prev.geometryVisibility,
        });
        if (typeof window !== 'undefined') {
            localStorage.setItem('diorama_tuning', JSON.stringify(next));
        }
        set({ dioramaTuning: next });
    },
    handleResetDioramaTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('diorama_tuning', JSON.stringify(DEFAULT_DIORAMA_TUNING));
        }
        set({ dioramaTuning: DEFAULT_DIORAMA_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.dioramaReset') });
    },
    handleSetMonetBackgroundTuning: (patch) => {
        const prev = get().monetBackgroundTuning;
        const next = resolveStoredMonetBackgroundTuning({
            ...prev,
            ...patch,
        });
        if (typeof window !== 'undefined') {
            localStorage.setItem('monet_background_tuning', JSON.stringify(next));
        }
        set({ monetBackgroundTuning: next });
    },
    handleResetMonetBackgroundTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('monet_background_tuning', JSON.stringify(DEFAULT_MONET_BACKGROUND_TUNING));
        }
        set({ monetBackgroundTuning: DEFAULT_MONET_BACKGROUND_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.monetBgReset') });
    },
    handleSetNomandBackgroundTuning: (patch) => {
        const next = resolveStoredNomandBackgroundTuning({
            ...get().nomandBackgroundTuning,
            ...patch,
        });
        if (typeof window !== 'undefined') {
            localStorage.setItem('nomand_background_tuning', JSON.stringify(next));
        }
        set({ nomandBackgroundTuning: next });
    },
    handleResetNomandBackgroundTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('nomand_background_tuning', JSON.stringify(DEFAULT_NOMAND_BACKGROUND_TUNING));
        }
        set({ nomandBackgroundTuning: DEFAULT_NOMAND_BACKGROUND_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.nomandBgReset') });
    },
    handleSetLatentBackgroundTuning: (patch) => {
        const next = resolveStoredLatentBackgroundTuning({
            ...get().latentBackgroundTuning,
            ...patch,
        });
        if (typeof window !== 'undefined') {
            localStorage.setItem('latent_background_tuning', JSON.stringify(next));
        }
        set({ latentBackgroundTuning: next });
    },
    handleResetLatentBackgroundTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('latent_background_tuning', JSON.stringify(DEFAULT_LATENT_BACKGROUND_TUNING));
        }
        set({ latentBackgroundTuning: DEFAULT_LATENT_BACKGROUND_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.latentBgReset') });
    },
    handleSetSoraBackgroundTuning: (patch) => {
        const next = resolveStoredSoraBackgroundTuning({
            ...get().soraBackgroundTuning,
            ...patch,
        });
        if (typeof window !== 'undefined') {
            localStorage.setItem('sora_background_tuning', JSON.stringify(next));
        }
        set({ soraBackgroundTuning: next });
    },
    handleResetSoraBackgroundTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('sora_background_tuning', JSON.stringify(DEFAULT_SORA_BACKGROUND_TUNING));
        }
        set({ soraBackgroundTuning: DEFAULT_SORA_BACKGROUND_TUNING });
    },
    handleSetMonetTuning: (patch) => {
        const prev = get().monetTuning;
        const next = resolveStoredMonetTuning({
            ...prev,
            ...patch,
        });
        if (typeof window !== 'undefined') {
            localStorage.setItem('monet_tuning', JSON.stringify(next));
        }
        set({ monetTuning: next });
    },
    handleResetMonetTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('monet_tuning', JSON.stringify(DEFAULT_MONET_TUNING));
        }
        set({ monetTuning: DEFAULT_MONET_TUNING });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.monetReset') });
    },
    handleUploadMonetBackgroundImage: async (files) => {
        const file = files[0];
        if (!file) {
            return { ok: false, error: i18n.t('notifications.selectImageFile') };
        }

        if (!isSupportedMonetBackgroundFile(file)) {
            return { ok: false, error: i18n.t('notifications.unsupportedImageFormat') };
        }

        const image = buildStoredMonetBackgroundImage(file);
        await saveMonetBackgroundImage(image);
        useVisualizerAssetStore.setState({ storedMonetBackgroundImage: image });
        setStatusMessage({ type: 'success', text: i18n.t('notifications.monetBgUpdated') });
        return { ok: true };
    },
    handleClearMonetBackgroundImage: async () => {
        await clearMonetBackgroundImage();
        const prev = get().monetBackgroundTuning;
        const nextTuning = prev.backgroundSource === 'uploaded-global'
            ? { ...prev, backgroundSource: 'cover-derived' as const }
            : prev;
        if (nextTuning !== prev && typeof window !== 'undefined') {
            localStorage.setItem('monet_background_tuning', JSON.stringify(nextTuning));
        }
        set({
            monetBackgroundTuning: nextTuning,
        });
        useVisualizerAssetStore.setState({
            storedMonetBackgroundImage: null,
            monetBackgroundImage: null,
        });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.monetBgCleared') });
    },
    handleUploadMonetPortraitImage: async (files) => {
        const file = files[0];
        if (!file) {
            return { ok: false, error: i18n.t('notifications.selectImageFile') };
        }

        if (!isSupportedMonetPortraitFile(file)) {
            return { ok: false, error: i18n.t('notifications.unsupportedImageFormat') };
        }

        const image = buildStoredMonetPortraitImage(file);
        await saveMonetPortraitImage(image);
        useVisualizerAssetStore.setState({ storedMonetPortraitImage: image });
        setStatusMessage({ type: 'success', text: i18n.t('notifications.monetPortraitUpdated') });
        return { ok: true };
    },
    handleClearMonetPortraitImage: async () => {
        await clearMonetPortraitImage();
        const prev = get().monetTuning;
        const nextTuning = prev.portraitSource === 'custom'
            ? { ...prev, portraitSource: 'cover' as const }
            : prev;
        if (nextTuning !== prev && typeof window !== 'undefined') {
            localStorage.setItem('monet_tuning', JSON.stringify(nextTuning));
        }
        set({
            monetTuning: nextTuning,
        });
        useVisualizerAssetStore.setState({
            storedMonetPortraitImage: null,
            monetPortraitImage: null,
        });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.monetPortraitCleared') });
    },
    handleImportCustomCappellaEmojiPack: async (files) => {
        if (files.length === 0) {
            return { ok: false, error: i18n.t('notifications.selectImageFile') };
        }

        const storedCappellaEmojiPack = useVisualizerAssetStore.getState().storedCappellaEmojiPack;

        if (!files.every(isSupportedCappellaEmojiFile)) {
            return { ok: false, error: i18n.t('notifications.unsupportedImageFormat') };
        }

        const appendedPack = buildStoredCappellaEmojiPack(files);
        const storedPack = [...storedCappellaEmojiPack, ...appendedPack];
        await saveCustomCappellaEmojiPack(storedPack);
        useVisualizerAssetStore.setState({ storedCappellaEmojiPack: storedPack });
        setStatusMessage({
            type: 'success',
            text: i18n.t('notifications.emojiPackAdded', { added: appendedPack.length, total: storedPack.length }),
        });

        return { ok: true };
    },
    handleClearCustomCappellaEmojiPack: async () => {
        await clearCustomCappellaEmojiPack();
        const prev = get().cappellaTuning;
        const nextTuning = prev.emojiPackSource === 'custom'
            ? { ...prev, emojiPackSource: 'builtin' as const }
            : prev;
        if (nextTuning !== prev && typeof window !== 'undefined') {
            localStorage.setItem('cappella_tuning', JSON.stringify(nextTuning));
        }
        set({
            cappellaTuning: nextTuning,
        });
        useVisualizerAssetStore.setState({
            storedCappellaEmojiPack: [],
        });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.emojiPackCleared') });
    },
    handleImportCustomCappellaAvatar: async (files) => {
        if (files.length === 0) {
            return { ok: false, error: i18n.t('notifications.selectImageFile') };
        }

        const storedCappellaAvatarPack = useVisualizerAssetStore.getState().storedCappellaAvatarPack;

        if (!files.every(isSupportedCappellaAvatarFile)) {
            return { ok: false, error: i18n.t('notifications.unsupportedImageFormat') };
        }

        const builtPack = buildStoredCappellaAvatar(files);
        const storedPack = [...storedCappellaAvatarPack, ...builtPack];
        await saveCustomCappellaAvatar(storedPack);
        useVisualizerAssetStore.setState({ storedCappellaAvatarPack: storedPack });
        setStatusMessage({
            type: 'success',
            text: i18n.t('notifications.avatarAdded', { added: builtPack.length, total: storedPack.length }),
        });

        return { ok: true };
    },
    handleClearCustomCappellaAvatar: async () => {
        await clearCustomCappellaAvatar();
        const prev = get().cappellaTuning;
        const nextTuning = prev.avatarSource === 'custom'
            ? { ...prev, avatarSource: 'builtin' as const }
            : prev;
        if (nextTuning !== prev && typeof window !== 'undefined') {
            localStorage.setItem('cappella_tuning', JSON.stringify(nextTuning));
        }
        set({
            cappellaTuning: nextTuning,
        });
        useVisualizerAssetStore.setState({
            storedCappellaAvatarPack: [],
        });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.avatarCleared') });
    },
}));

/**
 * The visualizer half of what selectSettingsUiSnapshot used to expose, kept as one grouped
 * selector for the settings surfaces that legitimately edit the whole domain at once.
 * Ordinary consumers should select the single field they need instead.
 */
export const selectVisualizerSettingsSnapshot = (state: VisualizerSettingsState) => ({
    backgroundOpacity: state.backgroundOpacity,
    cadenzaTuning: state.cadenzaTuning,
    cappellaTuning: state.cappellaTuning,
    claddaghTuning: state.claddaghTuning,
    classicTuning: state.classicTuning,
    dioramaTuning: state.dioramaTuning,
    disableVisualizerGeometricBackground: state.disableVisualizerGeometricBackground,
    disableVisualizerVignette: state.disableVisualizerVignette,
    fumeTuning: state.fumeTuning,
    handleAddUrlBackgroundItem: state.handleAddUrlBackgroundItem,
    handleClearCustomCappellaAvatar: state.handleClearCustomCappellaAvatar,
    handleClearCustomCappellaEmojiPack: state.handleClearCustomCappellaEmojiPack,
    handleClearMonetBackgroundImage: state.handleClearMonetBackgroundImage,
    handleClearMonetPortraitImage: state.handleClearMonetPortraitImage,
    handleDeleteUrlBackgroundItem: state.handleDeleteUrlBackgroundItem,
    handleImportCustomCappellaAvatar: state.handleImportCustomCappellaAvatar,
    handleImportCustomCappellaEmojiPack: state.handleImportCustomCappellaEmojiPack,
    handleResetCadenzaTuning: state.handleResetCadenzaTuning,
    handleResetCappellaTuning: state.handleResetCappellaTuning,
    handleResetCladdaghTuning: state.handleResetCladdaghTuning,
    handleResetClassicTuning: state.handleResetClassicTuning,
    handleResetDioramaTuning: state.handleResetDioramaTuning,
    handleResetFumeTuning: state.handleResetFumeTuning,
    handleResetLatentBackgroundTuning: state.handleResetLatentBackgroundTuning,
    handleResetLumiereTuning: state.handleResetLumiereTuning,
    handleResetMonetBackgroundTuning: state.handleResetMonetBackgroundTuning,
    handleResetMonetTuning: state.handleResetMonetTuning,
    handleResetNomandBackgroundTuning: state.handleResetNomandBackgroundTuning,
    handleResetPartitaTuning: state.handleResetPartitaTuning,
    handleResetPendoloTuning: state.handleResetPendoloTuning,
    handleResetSonnetTuning: state.handleResetSonnetTuning,
    handleResetSoraBackgroundTuning: state.handleResetSoraBackgroundTuning,
    handleResetTemperaTuning: state.handleResetTemperaTuning,
    handleResetTiltTuning: state.handleResetTiltTuning,
    handleResetVisualizerBackgroundMode: state.handleResetVisualizerBackgroundMode,
    handleSetBackgroundOpacity: state.handleSetBackgroundOpacity,
    handleSetCadenzaTuning: state.handleSetCadenzaTuning,
    handleSetCappellaTuning: state.handleSetCappellaTuning,
    handleSetCladdaghTuning: state.handleSetCladdaghTuning,
    handleSetClassicTuning: state.handleSetClassicTuning,
    handleSetDioramaTuning: state.handleSetDioramaTuning,
    handleSetFumeTuning: state.handleSetFumeTuning,
    handleSetLatentBackgroundTuning: state.handleSetLatentBackgroundTuning,
    handleSetLumiereTuning: state.handleSetLumiereTuning,
    handleSetMonetBackgroundTuning: state.handleSetMonetBackgroundTuning,
    handleSetMonetTuning: state.handleSetMonetTuning,
    handleSetNomandBackgroundTuning: state.handleSetNomandBackgroundTuning,
    handleSetPartitaTuning: state.handleSetPartitaTuning,
    handleSetPendoloTuning: state.handleSetPendoloTuning,
    handleSetSonnetTuning: state.handleSetSonnetTuning,
    handleSetSoraBackgroundTuning: state.handleSetSoraBackgroundTuning,
    handleSetTemperaTuning: state.handleSetTemperaTuning,
    handleSetTiltTuning: state.handleSetTiltTuning,
    handleSetUrlBackgroundList: state.handleSetUrlBackgroundList,
    handleSetUrlBackgroundSelectedId: state.handleSetUrlBackgroundSelectedId,
    handleSetVisualizerBackgroundMode: state.handleSetVisualizerBackgroundMode,
    handleSetVisualizerFrameRate: state.handleSetVisualizerFrameRate,
    handleSetVisualizerMode: state.handleSetVisualizerMode,
    handleSetVisualizerOpacity: state.handleSetVisualizerOpacity,
    handleToggleDisableVisualizerGeometricBackground: state.handleToggleDisableVisualizerGeometricBackground,
    handleToggleDisableVisualizerVignette: state.handleToggleDisableVisualizerVignette,
    handleToggleRandomVisualizerModePerSong: state.handleToggleRandomVisualizerModePerSong,
    handleUpdateUrlBackgroundItem: state.handleUpdateUrlBackgroundItem,
    handleUploadMonetBackgroundImage: state.handleUploadMonetBackgroundImage,
    handleUploadMonetPortraitImage: state.handleUploadMonetPortraitImage,
    latentBackgroundTuning: state.latentBackgroundTuning,
    lumiereTuning: state.lumiereTuning,
    monetBackgroundTuning: state.monetBackgroundTuning,
    monetTuning: state.monetTuning,
    nomandBackgroundTuning: state.nomandBackgroundTuning,
    partitaTuning: state.partitaTuning,
    pendoloTuning: state.pendoloTuning,
    randomVisualizerModePerSong: state.randomVisualizerModePerSong,
    sonnetTuning: state.sonnetTuning,
    soraBackgroundTuning: state.soraBackgroundTuning,
    temperaTuning: state.temperaTuning,
    tiltTuning: state.tiltTuning,
    urlBackgroundList: state.urlBackgroundList,
    urlBackgroundSelectedId: state.urlBackgroundSelectedId,
    visualizerBackgroundMode: state.visualizerBackgroundMode,
    visualizerFrameRate: state.visualizerFrameRate,
    visualizerMode: state.visualizerMode,
    visualizerOpacity: state.visualizerOpacity,
});

// Module-level handle for the assembly layer; an action needs no subscription.
export const handleSetVisualizerMode = (mode: VisualizerMode, options?: { notify?: boolean }) => (
    useVisualizerSettingsStore.getState().handleSetVisualizerMode(mode, options)
);
