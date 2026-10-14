import React, { useState } from 'react';
import { Gauge, MonitorCog, Video, Wallpaper } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Theme, VisualizerFrameRate } from '../../../types';
import { VISUALIZER_FRAME_RATE_OPTIONS } from '../../../utils/frameRateLimiter';
import ThemedDialog from '../../shared/ThemedDialog';
import { SettingsAnchor } from './navigation/SettingsAnchorContext';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';
import MotionReductionSettingsSection from './MotionReductionSettingsSection';
import SettingsRow, { SettingsToggle } from './SettingsRow';
import { settingsDividerClassFor } from './settingsCardClasses';
import { useThemeSettingsStore } from '../../../stores/useThemeSettingsStore';
import { usePlayerChromeSettingsStore } from '../../../stores/usePlayerChromeSettingsStore';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import { encodeWallpaperImage } from '../../../utils/wallpaperImage';
import { isCapacitorAndroid } from '../../../platform/runtime';
import {
    clearWallpaperBackgroundImage,
    clearWallpaperFont,
    clearWallpaperVideo as removeWallpaperVideo,
    getWallpaperLockScreenStatus,
    getWallpaperOverlayEventLog,
    hasWallpaperFont as queryWallpaperFont,
    hasWallpaperOverlayPermission,
    hasWallpaperVideo as queryWallpaperVideo,
    isLyricsWallpaperActive,
    openLyricsWallpaperPicker,
    openWallpaperOverlaySettings,
    pickWallpaperFont,
    pickWallpaperVideo,
    resetFloatingLyricsWindow,
} from '../../../platform/foliaWallpaper';
import type { WallpaperLockScreenStatus } from '../../../platform/foliaWallpaper';

// src/components/modal/settings/GraphicsSettingsSubview.tsx
// Everything that trades picture for smoothness or works around a renderer problem: static mode,
// the home background, native blur, the frame-rate cap, the Linux glow fix and reduced motion.
// Moved out of the lab page, where these sat among unrelated player-chrome switches.

/** Docs page behind the "Fix lyric animation freeze on Linux" switch. */
const CHROMIUM_FD_EXHAUSTION_DOCS_URL = 'https://folia-site.cielaniska.top/guide/chromium-fd-exhaustion';

/** On desktop a plain link would open inside the app window; hand it to the system browser instead. */
const openDocsLinkExternally = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!window.electron?.openExternalUrl) return;
    event.preventDefault();
    void window.electron.openExternalUrl(event.currentTarget.href);
};

const getFrameRateLabel = (frameRate: VisualizerFrameRate) => `${frameRate} FPS`;

/**
 * 打开开关时落在哪一档。
 *
 * 不能给 120：屏幕刷新率最多也就 120，限 120 和不限画出来是一模一样的两份 —— 以前默认给 120，
 * 于是「打开帧率限制」这一步看不出任何变化，用户只能以为开关坏了。给 60：一开就能看出来，
 * 想要满帧再往上拉到 120。
 */
const DEFAULT_VISUALIZER_FRAME_RATE: VisualizerFrameRate = 60;

/** 壁纸背景四种模式的文案键。列成一张表，加一种模式时只改这一处。 */
const BACKGROUND_LABEL_KEYS: Record<'cover' | 'color' | 'image' | 'video', string> = {
    cover: 'options.lyricsWallpaperBackgroundCover',
    color: 'options.lyricsWallpaperBackgroundColor',
    image: 'options.lyricsWallpaperBackgroundImage',
    video: 'options.lyricsWallpaperBackgroundVideo',
};

type GraphicsSettingsSubviewProps = {
    isDaylight: boolean;
    settingsCardClass: string;
    toggleOffBackgroundClass: string;
    utilityGhostButtonClass: string;
    rangeInputClass: string;
    theme?: Theme;
};

const GraphicsSettingsSubview: React.FC<GraphicsSettingsSubviewProps> = ({
    isDaylight,
    settingsCardClass,
    toggleOffBackgroundClass,
    utilityGhostButtonClass,
    rangeInputClass,
    theme,
}) => {
    const { t } = useTranslation();
    const [isNativeBlurNoticeOpen, setIsNativeBlurNoticeOpen] = useState(false);
    const {
        disableHomeDynamicBackground,
        staticMode,
        onToggleDisableHomeDynamicBackground,
        onToggleStaticMode,
    } = useThemeSettingsStore(useShallow(state => ({
        disableHomeDynamicBackground: state.disableHomeDynamicBackground,
        staticMode: state.staticMode,
        onToggleDisableHomeDynamicBackground: state.handleToggleDisableHomeDynamicBackground,
        onToggleStaticMode: state.handleToggleStaticMode,
    })));
    const enablePlayerPageNativeBlur = usePlayerChromeSettingsStore(state => state.enablePlayerPageNativeBlur);
    const onTogglePlayerPageNativeBlur = usePlayerChromeSettingsStore(state => state.handleTogglePlayerPageNativeBlur);
    const visualizerFrameRate = useVisualizerSettingsStore(state => state.visualizerFrameRate);
    const onVisualizerFrameRateChange = useVisualizerSettingsStore(state => state.handleSetVisualizerFrameRate);
    const glowBlurQuantize = useVisualizerSettingsStore(state => state.glowBlurQuantize);
    const onToggleGlowBlurQuantize = useVisualizerSettingsStore(state => state.handleToggleGlowBlurQuantize);
    const lyricsWallpaperFeed = useVisualizerSettingsStore(state => state.lyricsWallpaperFeed);
    const onToggleLyricsWallpaperFeed = useVisualizerSettingsStore(state => state.handleToggleLyricsWallpaperFeed);
    const lyricsWallpaperBackground = useVisualizerSettingsStore(state => state.lyricsWallpaperBackground);
    const onSetLyricsWallpaperBackground = useVisualizerSettingsStore(state => state.handleSetLyricsWallpaperBackground);
    const lyricsWallpaperImage = useVisualizerSettingsStore(state => state.lyricsWallpaperImage);
    const onSetLyricsWallpaperImage = useVisualizerSettingsStore(state => state.handleSetLyricsWallpaperImage);
    const lyricsWallpaperBlur = useVisualizerSettingsStore(state => state.lyricsWallpaperBlur);
    const onSetLyricsWallpaperBlur = useVisualizerSettingsStore(state => state.handleSetLyricsWallpaperBlur);
    const lyricsWallpaperProgress = useVisualizerSettingsStore(state => state.lyricsWallpaperProgress);
    const onToggleLyricsWallpaperProgress = useVisualizerSettingsStore(state => state.handleToggleLyricsWallpaperProgress);
    const lyricsWallpaperTranslation = useVisualizerSettingsStore(state => state.lyricsWallpaperTranslation);
    const onToggleLyricsWallpaperTranslation = useVisualizerSettingsStore(state => state.handleToggleLyricsWallpaperTranslation);
    const lyricsWallpaperStyle = useVisualizerSettingsStore(state => state.lyricsWallpaperStyle);
    const onSetLyricsWallpaperStyle = useVisualizerSettingsStore(state => state.handleSetLyricsWallpaperStyle);
    const wallpaperOverlayEnabled = useVisualizerSettingsStore(state => state.wallpaperOverlayEnabled);
    const onToggleWallpaperOverlayEnabled = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayEnabled);
    const wallpaperOverlayLockScreen = useVisualizerSettingsStore(state => state.wallpaperOverlayLockScreen);
    const onToggleWallpaperOverlayLockScreen = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayLockScreen);
    const wallpaperOverlayLockScreenOnly = useVisualizerSettingsStore(state => state.wallpaperOverlayLockScreenOnly);
    const onToggleWallpaperOverlayLockScreenOnly = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayLockScreenOnly);
    const wallpaperOverlayOpacity = useVisualizerSettingsStore(state => state.wallpaperOverlayOpacity);
    const onSetWallpaperOverlayOpacity = useVisualizerSettingsStore(state => state.handleSetWallpaperOverlayOpacity);
    // 「精简」样式那颗悬浮歌词小窗的底色浓度。单独一根滑条，不复用叠层那根。
    const wallpaperFloatingOpacity = useVisualizerSettingsStore(state => state.wallpaperFloatingOpacity);
    const onSetWallpaperFloatingOpacity = useVisualizerSettingsStore(state => state.handleSetWallpaperFloatingOpacity);
    // 小窗叠在安全区上面 + 叠加模式下的左右位置。
    const wallpaperFloatingOverSafeArea = useVisualizerSettingsStore(
        state => state.wallpaperFloatingOverSafeArea);
    const onToggleWallpaperFloatingOverSafeArea = useVisualizerSettingsStore(
        state => state.handleToggleWallpaperFloatingOverSafeArea);
    const wallpaperFloatingOffsetX = useVisualizerSettingsStore(
        state => state.wallpaperFloatingOffsetX);
    const onSetWallpaperFloatingOffsetX = useVisualizerSettingsStore(
        state => state.handleSetWallpaperFloatingOffsetX);
    const wallpaperFloatingWidth = useVisualizerSettingsStore(
        state => state.wallpaperFloatingWidth);
    const onSetWallpaperFloatingWidth = useVisualizerSettingsStore(
        state => state.handleSetWallpaperFloatingWidth);
    // 占满整条安全区 + 避开区域（宽度 / 左右位置）。
    const wallpaperFloatingFillSafeArea = useVisualizerSettingsStore(
        state => state.wallpaperFloatingFillSafeArea);
    const onToggleWallpaperFloatingFillSafeArea = useVisualizerSettingsStore(
        state => state.handleToggleWallpaperFloatingFillSafeArea);
    const wallpaperFloatingAvoidWidth = useVisualizerSettingsStore(
        state => state.wallpaperFloatingAvoidWidth);
    const onSetWallpaperFloatingAvoidWidth = useVisualizerSettingsStore(
        state => state.handleSetWallpaperFloatingAvoidWidth);
    const wallpaperFloatingAvoidOffsetX = useVisualizerSettingsStore(
        state => state.wallpaperFloatingAvoidOffsetX);
    const onSetWallpaperFloatingAvoidOffsetX = useVisualizerSettingsStore(
        state => state.handleSetWallpaperFloatingAvoidOffsetX);
    // 字号：动态（跟着窗口高度算）/ 自定义（自己指定 dp）。
    const wallpaperFloatingFontSizeMode = useVisualizerSettingsStore(
        state => state.wallpaperFloatingFontSizeMode);
    const onSetWallpaperFloatingFontSizeMode = useVisualizerSettingsStore(
        state => state.handleSetWallpaperFloatingFontSizeMode);
    const wallpaperFloatingFontSize = useVisualizerSettingsStore(
        state => state.wallpaperFloatingFontSize);
    const onSetWallpaperFloatingFontSize = useVisualizerSettingsStore(
        state => state.handleSetWallpaperFloatingFontSize);
    const wallpaperOverlayAllApps = useVisualizerSettingsStore(state => state.wallpaperOverlayAllApps);
    const onToggleWallpaperOverlayAllApps = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayAllApps);
    const wallpaperOverlayHideNativeLyrics = useVisualizerSettingsStore(state => state.wallpaperOverlayHideNativeLyrics);
    const onToggleWallpaperOverlayHideNativeLyrics = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayHideNativeLyrics);
    const wallpaperOverlayHideNativeProgress = useVisualizerSettingsStore(state => state.wallpaperOverlayHideNativeProgress);
    const onToggleWallpaperOverlayHideNativeProgress = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayHideNativeProgress);
    const wallpaperOverlaySkipInstrumental = useVisualizerSettingsStore(state => state.wallpaperOverlaySkipInstrumental);
    const onToggleWallpaperOverlaySkipInstrumental = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlaySkipInstrumental);
    const wallpaperOverlayHideWhenPaused = useVisualizerSettingsStore(state => state.wallpaperOverlayHideWhenPaused);
    const onToggleWallpaperOverlayHideWhenPaused = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayHideWhenPaused);
    const wallpaperOverlayHideAfterLyricsEnd = useVisualizerSettingsStore(state => state.wallpaperOverlayHideAfterLyricsEnd);
    const onToggleWallpaperOverlayHideAfterLyricsEnd = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayHideAfterLyricsEnd);
    const wallpaperOverlayHideCoverArt = useVisualizerSettingsStore(state => state.wallpaperOverlayHideCoverArt);
    const onToggleWallpaperOverlayHideCoverArt = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayHideCoverArt);
    const imageInputRef = React.useRef<HTMLInputElement | null>(null);

    /*
     * 音乐锁屏的自诊断。
     *
     * 「后台启动 Activity 被系统拦」是**静默**的：不抛异常、不返回失败码，
     * 而真机上的 logcat 基本取不到。没有这一行提示，用户只能对着一个没反应的
     * 开关猜到底是没到时机（还没熄屏过），还是被系统 / ROM 挡住了。
     */
    const [lockScreenStatus, setLockScreenStatus] =
        React.useState<WallpaperLockScreenStatus | null>(null);
    // 「仅在锁屏显示」也会把锁屏页带起来，所以诊断对它同样有意义。
    const lockScreenActive = wallpaperOverlayLockScreen || wallpaperOverlayLockScreenOnly;
    React.useEffect(() => {
        if (!lockScreenActive) {
            setLockScreenStatus(null);
            return;
        }
        let cancelled = false;
        const load = async () => {
            const status = await getWallpaperLockScreenStatus();
            if (!cancelled) setLockScreenStatus(status);
        };
        void load();
        const timer = window.setInterval(() => void load(), 4000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [lockScreenActive]);

    /*
     * 叠层最近做了什么（新的在前）。
     *
     * 「叠层放着放着突然消失、然后又淡入」在代码里至少有四条完全不同的来路 ——
     * 窗口淡出、整页重载（设置变了 / 自愈觉得页面坏了）、息屏摘窗口、被系统悄悄摘窗口 ——
     * 画面上四条一模一样，而真机上的 logcat 基本取不到（很多 ROM 根本不给读）。
     * 所以让原生把「动作 + 当时为什么」记成一串短行，这里读出来直接摆给用户看，
     * 不用再靠描述现象猜。只在叠层开着时轮询。
     */
    const [overlayEventLog, setOverlayEventLog] = React.useState<string[]>([]);
    React.useEffect(() => {
        if (!wallpaperOverlayEnabled || !isCapacitorAndroid()) {
            setOverlayEventLog([]);
            return;
        }
        let cancelled = false;
        const load = async () => {
            const events = await getWallpaperOverlayEventLog();
            if (!cancelled) setOverlayEventLog(events);
        };
        void load();
        const timer = window.setInterval(() => void load(), 3000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [wallpaperOverlayEnabled]);

    const handleWallpaperImagePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        const encoded = await encodeWallpaperImage(file);
        if (encoded) onSetLyricsWallpaperImage(encoded);
    };

    // 歌词壁纸是 Android 专有的，其它平台整段不渲染。
    const isAndroid = isCapacitorAndroid();
    const [isWallpaperActive, setIsWallpaperActive] = useState(false);

    React.useEffect(() => {
        if (!isAndroid) return;
        let cancelled = false;
        void isLyricsWallpaperActive().then((active) => {
            if (!cancelled) setIsWallpaperActive(active);
        });
        return () => {
            cancelled = true;
        };
    }, [isAndroid]);

    /*
     * 视频壁纸有没有上传。
     *
     * 视频是原生自己拷进私有目录的（几十 MB 不过桥），Web 侧拿不到内容，
     * 只能问一句「有没有」，用来决定按钮写「上传」还是「更换」。
     */
    const [hasVideo, setHasVideo] = useState(false);
    React.useEffect(() => {
        if (!isAndroid) return;
        let cancelled = false;
        void queryWallpaperVideo().then((has) => {
            if (!cancelled) setHasVideo(has);
        });
        return () => {
            cancelled = true;
        };
    }, [isAndroid, lyricsWallpaperBackground]);

    const handlePickVideo = async () => {
        const result = await pickWallpaperVideo();
        if (result === 'applied') setHasVideo(true);
    };

    const handleClearVideo = async () => {
        await removeWallpaperVideo();
        setHasVideo(false);
    };

    const handleOpenWallpaperPicker = () => {
        void openLyricsWallpaperPicker();
        // 系统选择器要用户手动确认，返回后状态才变，延后复查一次。
        window.setTimeout(() => {
            void isLyricsWallpaperActive().then(setIsWallpaperActive);
        }, 3000);
    };

    // 可视化叠层要「显示在其他应用上层」权限，没授权时它是静默不启用的。
    const [hasOverlayPermission, setHasOverlayPermission] = useState(false);

    React.useEffect(() => {
        if (!isAndroid) return;
        let cancelled = false;
        void hasWallpaperOverlayPermission().then((granted) => {
            if (!cancelled) setHasOverlayPermission(granted);
        });
        return () => {
            cancelled = true;
        };
    }, [isAndroid]);

    const handleOpenOverlaySettings = () => {
        void openWallpaperOverlaySettings();
        // 授权页是系统界面，用户回来之后才生效，延后复查一次。
        window.setTimeout(() => {
            void hasWallpaperOverlayPermission().then(setHasOverlayPermission);
        }, 3000);
    };

    // 「重置悬浮窗」按完之后给个回执：小窗此刻多半不在屏幕上（应用在前台它就不挂），
    // 点了没反应会让人以为按钮坏了。
    const [floatingResetDone, setFloatingResetDone] = useState(false);

    const handleResetFloatingLyricsWindow = () => {
        void resetFloatingLyricsWindow();
        setFloatingResetDone(true);
        window.setTimeout(() => setFloatingResetDone(false), 2000);
    };

    // 字体是原生落在私有目录里的文件，应用这边只缓存一个「有没有」用于按钮文案。
    const [hasWallpaperFont, setHasWallpaperFont] = useState(false);
    const [fontNotice, setFontNotice] = useState<'applied' | 'rejected' | null>(null);

    React.useEffect(() => {
        if (!isAndroid) return;
        let cancelled = false;
        void queryWallpaperFont().then((value) => {
            if (!cancelled) setHasWallpaperFont(value);
        });
        return () => {
            cancelled = true;
        };
    }, [isAndroid]);

    const handlePickWallpaperFont = async () => {
        const result = await pickWallpaperFont();
        if (result === 'cancelled') return;
        setHasWallpaperFont(result === 'applied');
        setFontNotice(result);
        window.setTimeout(() => setFontNotice(null), 3200);
    };

    const handleClearWallpaperFont = () => {
        setHasWallpaperFont(false);
        setFontNotice(null);
        void clearWallpaperFont();
    };

    const dividerClass = settingsDividerClassFor(isDaylight);
    const isLinux = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('linux');
    const isVisualizerFrameRateLimiterEnabled = visualizerFrameRate !== 'off';
    // 关着的时候档位显示 120：那正是「不限」的意思 —— 画到屏幕刷新率为止。
    const selectedVisualizerFrameRate = isVisualizerFrameRateLimiterEnabled ? visualizerFrameRate : 120;
    const selectedVisualizerFrameRateIndex = VISUALIZER_FRAME_RATE_OPTIONS.indexOf(selectedVisualizerFrameRate);

    const renderToggle = (checked: boolean, onChange: () => void) => (
        <SettingsToggle checked={checked} onChange={onChange} offClass={toggleOffBackgroundClass} onColor={theme?.secondaryColor} />
    );

    // Native blur can drop frames on some GPUs, so switching it on goes through a confirmation.
    const handleNativeBlurToggle = () => {
        if (enablePlayerPageNativeBlur) {
            onTogglePlayerPageNativeBlur(false);
            return;
        }
        setIsNativeBlurNoticeOpen(true);
    };

    const confirmNativeBlur = () => {
        onTogglePlayerPageNativeBlur(true);
        setIsNativeBlurNoticeOpen(false);
    };

    const handleFrameRateSliderChange = (value: string) => {
        const nextIndex = Math.min(VISUALIZER_FRAME_RATE_OPTIONS.length - 1, Math.max(0, Number(value)));
        onVisualizerFrameRateChange(VISUALIZER_FRAME_RATE_OPTIONS[nextIndex]);
    };

    return (
        <div className="space-y-5">
            <SettingsAnchor anchorId="graphicsPerformance" label={t('options.labPerformanceSection')} className="space-y-4">
                <SettingsSectionHeading icon={MonitorCog} label={t('options.labPerformanceSection')} />
                <div className={`rounded-xl border overflow-hidden ${settingsCardClass}`}>
                    <SettingsRow
                        title={t('options.enableStaticMode')}
                        description={t('options.enableStaticModeDesc')}
                        note={t('options.enableStaticModeDescSub')}
                        control={renderToggle(staticMode, () => onToggleStaticMode(!staticMode))}
                        dividerClass={dividerClass}
                    />
                    <SettingsRow
                        title={t('options.disableHomeDynamicBackground')}
                        description={t('options.disableHomeDynamicBackgroundDesc')}
                        note={t('options.disableHomeDynamicBackgroundWarning')}
                        control={renderToggle(disableHomeDynamicBackground, () => onToggleDisableHomeDynamicBackground(!disableHomeDynamicBackground))}
                        dividerClass={dividerClass}
                    />
                    {!isLinux && (
                        <SettingsRow
                            title={t('options.enablePlayerPageNativeBlur')}
                            description={t('options.enablePlayerPageNativeBlurDesc')}
                            control={renderToggle(enablePlayerPageNativeBlur, handleNativeBlurToggle)}
                            dividerClass={dividerClass}
                        />
                    )}
                    <SettingsRow
                        title={t('options.visualizerFrameRate')}
                        description={t('options.visualizerFrameRateDesc')}
                        control={renderToggle(
                            isVisualizerFrameRateLimiterEnabled,
                            () => onVisualizerFrameRateChange(isVisualizerFrameRateLimiterEnabled ? 'off' : DEFAULT_VISUALIZER_FRAME_RATE),
                        )}
                        dividerClass={dividerClass}
                    >
                        <div className={`space-y-3 transition-opacity ${isVisualizerFrameRateLimiterEnabled ? 'opacity-100' : 'opacity-45 pointer-events-none'}`}>
                            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                                <span className="opacity-60">{t('options.visualizerFrameRateValue')}</span>
                                <span className="font-mono opacity-70">{getFrameRateLabel(selectedVisualizerFrameRate)}</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max={VISUALIZER_FRAME_RATE_OPTIONS.length - 1}
                                step="1"
                                value={Math.max(0, selectedVisualizerFrameRateIndex)}
                                onChange={(event) => handleFrameRateSliderChange(event.target.value)}
                                className={rangeInputClass}
                                aria-label={t('options.visualizerFrameRateValue')}
                                disabled={!isVisualizerFrameRateLimiterEnabled}
                            />
                            {/* 档位数量会变（现在是 30/60/90/120），刻度用两端对齐而不是写死的几列。 */}
                            <div className="flex justify-between text-[11px] font-mono opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {VISUALIZER_FRAME_RATE_OPTIONS.map(frameRate => (
                                    <span key={frameRate}>{frameRate}</span>
                                ))}
                            </div>
                        </div>
                    </SettingsRow>
                    <SettingsRow
                        title={t('options.glowBlurQuantize')}
                        description={(
                            <>
                                {t('options.glowBlurQuantizeDesc')}{' '}
                                <a
                                    href={CHROMIUM_FD_EXHAUSTION_DOCS_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={openDocsLinkExternally}
                                    className="underline underline-offset-2 hover:opacity-80"
                                >
                                    {t('options.glowBlurQuantizeDocs')}
                                </a>
                            </>
                        )}
                        control={renderToggle(glowBlurQuantize, () => onToggleGlowBlurQuantize(!glowBlurQuantize))}
                        dividerClass={dividerClass}
                        isLast
                    />
                </div>
            </SettingsAnchor>

            <SettingsAnchor anchorId="graphicsMotion" label={t('options.reduceMotionSection')} className="space-y-4">
                <SettingsSectionHeading icon={Gauge} label={t('options.reduceMotionSection')} />
                <MotionReductionSettingsSection
                    settingsCardClass={settingsCardClass}
                    settingsDividerClass={dividerClass}
                    toggleOffBackgroundClass={toggleOffBackgroundClass}
                    theme={theme}
                />
            </SettingsAnchor>

            {isAndroid && (
                <SettingsAnchor anchorId="graphicsLyricsWallpaper" label={t('options.lyricsWallpaperSection')} className="space-y-4">
                    <SettingsSectionHeading icon={Wallpaper} label={t('options.lyricsWallpaperSection')} />
                    <div className={`rounded-xl border overflow-hidden ${settingsCardClass}`}>
                        <SettingsRow
                            title={t('options.lyricsWallpaperApply')}
                            description={t('options.lyricsWallpaperApplyDesc')}
                            control={(
                                <button
                                    type="button"
                                    onClick={handleOpenWallpaperPicker}
                                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${utilityGhostButtonClass}`}
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {isWallpaperActive
                                        ? t('options.lyricsWallpaperActive')
                                        : t('options.lyricsWallpaperSet')}
                                </button>
                            )}
                            dividerClass={dividerClass}
                        />
                        <SettingsRow
                            title={t('options.lyricsWallpaperStyle')}
                            description={lyricsWallpaperStyle === 'minimal'
                                ? t('options.lyricsWallpaperStyleMinimalDesc')
                                : t('options.lyricsWallpaperStyleDesc')}
                            dividerClass={dividerClass}
                            control={(
                                <div className="flex items-center gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--text-secondary)' }}>
                                    {(['minimal', 'follow'] as const).map((style) => (
                                        <button
                                            key={style}
                                            type="button"
                                            onClick={() => onSetLyricsWallpaperStyle(style)}
                                            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${lyricsWallpaperStyle === style ? '' : 'opacity-60'}`}
                                            style={lyricsWallpaperStyle === style
                                                ? { backgroundColor: theme?.accentColor || '#3b82f6', color: '#fff' }
                                                : { color: 'var(--text-primary)' }}
                                        >
                                            {style === 'minimal'
                                                ? t('options.lyricsWallpaperStyleMinimal')
                                                : t('options.lyricsWallpaperStyleFollow')}
                                        </button>
                                    ))}
                                </div>
                            )}
                        />
                        {/* 精简模式下歌词是那颗可以拖的小窗，拖到角落 / 缩到最小又上了锁之后
                            光靠手势弄不回来，所以这里给一颗「重置」当出口。 */}
                        {lyricsWallpaperStyle === 'minimal' && (
                            <>
                                {/* 小窗的底色浓度。单独一根：它是另一层系统窗口，
                                    跟壁纸背景那根、叠层那根都无关。 */}
                                <SettingsRow
                                    title={t('options.floatingLyricsOpacity')}
                                    description={t('options.floatingLyricsOpacityDesc')}
                                    dividerClass={dividerClass}
                                    control={(
                                        <div className="flex items-center gap-2">
                                            {/* 下限 0：要的就是「只有字、没有底」，尤其叠在安全区上时。 */}
                                            <input
                                                type="range"
                                                min={0}
                                                max={100}
                                                step={5}
                                                value={Math.round(wallpaperFloatingOpacity * 100)}
                                                onChange={(event) => onSetWallpaperFloatingOpacity(Number(event.target.value) / 100)}
                                                className="h-1 w-28 cursor-pointer accent-white"
                                            />
                                            <span className="w-9 text-right font-mono text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                                {Math.round(wallpaperFloatingOpacity * 100)}%
                                            </span>
                                        </div>
                                    )}
                                />
                                {/* 叠在安全区上面：小窗贴到屏幕最顶上那一条（盖住状态栏），
                                    此时高度方向不再参与摆放，只给左右。 */}
                                <SettingsRow
                                    title={t('options.floatingLyricsOverSafeArea')}
                                    description={t('options.floatingLyricsOverSafeAreaDesc')}
                                    dividerClass={dividerClass}
                                    control={(
                                        <button
                                            type="button"
                                            onClick={() => onToggleWallpaperFloatingOverSafeArea(!wallpaperFloatingOverSafeArea)}
                                            className={`h-6 w-12 shrink-0 rounded-full p-1 transition-colors ${!wallpaperFloatingOverSafeArea ? toggleOffBackgroundClass : ''}`}
                                            style={{ backgroundColor: wallpaperFloatingOverSafeArea ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                        >
                                            <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${wallpaperFloatingOverSafeArea ? 'translate-x-6' : 'translate-x-0'}`} />
                                        </button>
                                    )}
                                />
                                {/* 叠加模式下的左右位置。只给初值：原生那边拖过之后以拖出来的为准。
                                    占满整条时没有「左右」可言，那两根一起收起来。 */}
                                {wallpaperFloatingOverSafeArea && !wallpaperFloatingFillSafeArea && (
                                    <SettingsRow
                                        title={t('options.floatingLyricsOffsetX')}
                                        description={t('options.floatingLyricsOffsetXDesc')}
                                        dividerClass={dividerClass}
                                        control={(
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={100}
                                                    step={5}
                                                    value={Math.round(wallpaperFloatingOffsetX * 100)}
                                                    onChange={(event) => onSetWallpaperFloatingOffsetX(Number(event.target.value) / 100)}
                                                    className="h-1 w-28 cursor-pointer accent-white"
                                                />
                                                <span className="w-9 text-right font-mono text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                                    {Math.round(wallpaperFloatingOffsetX * 100)}%
                                                </span>
                                            </div>
                                        )}
                                    />
                                )}
                                {/* 宽度：占屏幕宽度的比例。和左右位置那根一样，
                                    每次拖动都会立刻下发，小窗当场跟着变。占满时不参与。 */}
                                {wallpaperFloatingOverSafeArea && !wallpaperFloatingFillSafeArea && (
                                    <SettingsRow
                                        title={t('options.floatingLyricsWidth')}
                                        description={t('options.floatingLyricsWidthDesc')}
                                        dividerClass={dividerClass}
                                        control={(
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="range"
                                                    min={50}
                                                    max={100}
                                                    step={5}
                                                    value={Math.round(wallpaperFloatingWidth * 100)}
                                                    onChange={(event) => onSetWallpaperFloatingWidth(Number(event.target.value) / 100)}
                                                    className="h-1 w-28 cursor-pointer accent-white"
                                                />
                                                <span className="w-9 text-right font-mono text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                                    {Math.round(wallpaperFloatingWidth * 100)}%
                                                </span>
                                            </div>
                                        )}
                                    />
                                )}
                                {/* 占满整条安全区：左右不再留空，宽度滑条也让位。
                                    横屏下原生那边不认这一条，自动退回宽度滑条给的宽。 */}
                                {wallpaperFloatingOverSafeArea && (
                                    <SettingsRow
                                        title={t('options.floatingLyricsFillSafeArea')}
                                        description={t('options.floatingLyricsFillSafeAreaDesc')}
                                        dividerClass={dividerClass}
                                        control={(
                                            <button
                                                type="button"
                                                onClick={() => onToggleWallpaperFloatingFillSafeArea(!wallpaperFloatingFillSafeArea)}
                                                className={`h-6 w-12 shrink-0 rounded-full p-1 transition-colors ${!wallpaperFloatingFillSafeArea ? toggleOffBackgroundClass : ''}`}
                                                style={{ backgroundColor: wallpaperFloatingFillSafeArea ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                            >
                                                <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${wallpaperFloatingFillSafeArea ? 'translate-x-6' : 'translate-x-0'}`} />
                                            </button>
                                        )}
                                    />
                                )}
                                {/* 避开区域：挖孔 / 刘海那一块。字从它两边绕过去，不是被裁掉。 */}
                                {wallpaperFloatingOverSafeArea && wallpaperFloatingFillSafeArea && (
                                    <>
                                        <SettingsRow
                                            title={t('options.floatingLyricsAvoidWidth')}
                                            description={t('options.floatingLyricsAvoidWidthDesc')}
                                            dividerClass={dividerClass}
                                            control={(
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="range"
                                                        min={0}
                                                        max={50}
                                                        step={2}
                                                        value={Math.round(wallpaperFloatingAvoidWidth * 100)}
                                                        onChange={(event) => onSetWallpaperFloatingAvoidWidth(Number(event.target.value) / 100)}
                                                        className="h-1 w-28 cursor-pointer accent-white"
                                                    />
                                                    <span className="w-9 text-right font-mono text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                                        {Math.round(wallpaperFloatingAvoidWidth * 100)}%
                                                    </span>
                                                </div>
                                            )}
                                        />
                                        <SettingsRow
                                            title={t('options.floatingLyricsAvoidOffsetX')}
                                            description={t('options.floatingLyricsAvoidOffsetXDesc')}
                                            dividerClass={dividerClass}
                                            control={(
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="range"
                                                        min={0}
                                                        max={100}
                                                        step={2}
                                                        value={Math.round(wallpaperFloatingAvoidOffsetX * 100)}
                                                        onChange={(event) => onSetWallpaperFloatingAvoidOffsetX(Number(event.target.value) / 100)}
                                                        className="h-1 w-28 cursor-pointer accent-white"
                                                    />
                                                    <span className="w-9 text-right font-mono text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                                        {Math.round(wallpaperFloatingAvoidOffsetX * 100)}%
                                                    </span>
                                                </div>
                                            )}
                                        />
                                    </>
                                )}
                                {/* 字号：动态 = 跟着窗口高度算（拖大窗口字就跟着大）；
                                    自定义 = 自己指定。默认动态。 */}
                                <SettingsRow
                                    title={t('options.floatingLyricsFontSize')}
                                    description={t('options.floatingLyricsFontSizeDesc')}
                                    dividerClass={dividerClass}
                                    control={(
                                        <div className="flex items-center gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--text-secondary)' }}>
                                            {(['dynamic', 'custom'] as const).map((mode) => (
                                                <button
                                                    key={mode}
                                                    type="button"
                                                    onClick={() => onSetWallpaperFloatingFontSizeMode(mode)}
                                                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${wallpaperFloatingFontSizeMode === mode ? '' : 'opacity-60'}`}
                                                    style={wallpaperFloatingFontSizeMode === mode
                                                        ? { backgroundColor: theme?.accentColor || '#3b82f6', color: '#fff' }
                                                        : { color: 'var(--text-primary)' }}
                                                >
                                                    {mode === 'dynamic'
                                                        ? t('options.floatingLyricsFontSizeDynamic')
                                                        : t('options.floatingLyricsFontSizeCustom')}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                />
                                {wallpaperFloatingFontSizeMode === 'custom' && (
                                    <SettingsRow
                                        title={t('options.floatingLyricsFontSizeCustom')}
                                        description={t('options.floatingLyricsFontSizeCustomDesc')}
                                        dividerClass={dividerClass}
                                        control={(
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="range"
                                                    min={10}
                                                    max={32}
                                                    step={1}
                                                    value={Math.round(wallpaperFloatingFontSize)}
                                                    onChange={(event) => onSetWallpaperFloatingFontSize(Number(event.target.value))}
                                                    className="h-1 w-28 cursor-pointer accent-white"
                                                />
                                                <span className="w-9 text-right font-mono text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                                    {Math.round(wallpaperFloatingFontSize)}
                                                </span>
                                            </div>
                                        )}
                                    />
                                )}
                                {/* 拖到角落 / 缩到最小又上了锁之后光靠手势弄不回来，
                                    所以这里给一颗「重置」当出口。 */}
                                <SettingsRow
                                    title={t('options.floatingLyricsWindow')}
                                    description={t('options.floatingLyricsResetDesc')}
                                    dividerClass={dividerClass}
                                    control={(
                                        <button
                                            type="button"
                                            onClick={handleResetFloatingLyricsWindow}
                                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${utilityGhostButtonClass}`}
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            {floatingResetDone
                                                ? t('options.floatingLyricsResetDone')
                                                : t('options.floatingLyricsReset')}
                                        </button>
                                    )}
                                />
                            </>
                        )}
                        {/* 可视化叠层要 SYSTEM_ALERT_WINDOW；没授权时它静默不工作，
                            用户只会看到「壁纸跟以前一样」，所以这里必须给明确入口。 */}
                        <SettingsRow
                            title={t('options.lyricsWallpaperOverlay')}
                            description={t('options.lyricsWallpaperOverlayDesc')}
                            dividerClass={dividerClass}
                            control={(
                                <button
                                    type="button"
                                    onClick={handleOpenOverlaySettings}
                                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${utilityGhostButtonClass}`}
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {hasOverlayPermission
                                        ? t('options.lyricsWallpaperOverlayGranted')
                                        : t('options.lyricsWallpaperOverlayGrant')}
                                </button>
                            )}
                        />
                        {/* 叠层总开关：关掉之后一层都不挂，下面几项也就没有意义了。 */}
                        <SettingsRow
                            title={t('options.wallpaperOverlayEnabled')}
                            description={t('options.wallpaperOverlayEnabledDesc')}
                            dividerClass={dividerClass}
                            control={(
                                <button
                                    type="button"
                                    onClick={() => onToggleWallpaperOverlayEnabled(!wallpaperOverlayEnabled)}
                                    className={`h-6 w-12 shrink-0 rounded-full p-1 transition-colors ${!wallpaperOverlayEnabled ? toggleOffBackgroundClass : ''}`}
                                    style={{ backgroundColor: wallpaperOverlayEnabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                >
                                    <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${wallpaperOverlayEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            )}
                        />
                        {/* 叠层不透明度：整层从几乎看不见到完全不透明。 */}
                        <SettingsRow
                            title={t('options.wallpaperOverlayOpacity')}
                            description={t('options.wallpaperOverlayOpacityDesc')}
                            dividerClass={dividerClass}
                            control={(
                                <div className="flex items-center gap-2">
                                    <input
                                        type="range"
                                        min={10}
                                        max={100}
                                        step={5}
                                        value={Math.round(wallpaperOverlayOpacity * 100)}
                                        onChange={(event) => onSetWallpaperOverlayOpacity(Number(event.target.value) / 100)}
                                        className="h-1 w-28 cursor-pointer accent-white"
                                    />
                                    <span className="w-9 text-right font-mono text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                        {Math.round(wallpaperOverlayOpacity * 100)}%
                                    </span>
                                </div>
                            )}
                        />
                        {/* 叠层是否在所有应用之上显示。 */}
                        <SettingsRow
                            title={t('options.wallpaperOverlayAllApps')}
                            description={t('options.wallpaperOverlayAllAppsDesc')}
                            dividerClass={dividerClass}
                            control={(
                                <button
                                    type="button"
                                    onClick={() => onToggleWallpaperOverlayAllApps(!wallpaperOverlayAllApps)}
                                    className={`h-6 w-12 shrink-0 rounded-full p-1 transition-colors ${!wallpaperOverlayAllApps ? toggleOffBackgroundClass : ''}`}
                                    style={{ backgroundColor: wallpaperOverlayAllApps ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                >
                                    <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${wallpaperOverlayAllApps ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            )}
                        />
                        {/* 音乐锁屏：锁屏之上也挂同一层。 */}
                        <SettingsRow
                            title={t('options.wallpaperOverlayLockScreen')}
                            description={t('options.wallpaperOverlayLockScreenDesc')}
                            dividerClass={dividerClass}
                            control={(
                                <button
                                    type="button"
                                    onClick={() => onToggleWallpaperOverlayLockScreen(!wallpaperOverlayLockScreen)}
                                    className={`h-6 w-12 shrink-0 rounded-full p-1 transition-colors ${!wallpaperOverlayLockScreen ? toggleOffBackgroundClass : ''}`}
                                    style={{ backgroundColor: wallpaperOverlayLockScreen ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                >
                                    <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${wallpaperOverlayLockScreen ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            )}
                        />
                        {/* 叠层只在锁屏上出现：桌面 / 所有应用 / App 内都不挂。 */}
                        <SettingsRow
                            title={t('options.wallpaperOverlayLockScreenOnly')}
                            description={t('options.wallpaperOverlayLockScreenOnlyDesc')}
                            dividerClass={dividerClass}
                            control={(
                                <button
                                    type="button"
                                    onClick={() => onToggleWallpaperOverlayLockScreenOnly(!wallpaperOverlayLockScreenOnly)}
                                    className={`h-6 w-12 shrink-0 rounded-full p-1 transition-colors ${!wallpaperOverlayLockScreenOnly ? toggleOffBackgroundClass : ''}`}
                                    style={{ backgroundColor: wallpaperOverlayLockScreenOnly ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                >
                                    <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${wallpaperOverlayLockScreenOnly ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            )}
                        />
                        {lockScreenActive && lockScreenStatus && (
                            <p
                                className="px-4 pb-3 text-xs leading-relaxed"
                                style={{ color: 'var(--text-secondary)' }}
                            >
                                {lockScreenStatus.blocked
                                    ? t('options.wallpaperOverlayLockScreenBlocked')
                                    : (lockScreenStatus.hosted || lockScreenStatus.started)
                                        ? t('options.wallpaperOverlayLockScreenReady')
                                        : t('options.wallpaperOverlayLockScreenWaiting')}
                            </p>
                        )}
                        {lockScreenActive && lockScreenStatus?.lastExit && (
                            <p
                                className="px-4 pb-3 text-xs leading-relaxed opacity-70"
                                style={{ color: 'var(--text-secondary)' }}
                            >
                                {t('options.wallpaperOverlayLockScreenLastExit')}{lockScreenStatus.lastExit}
                            </p>
                        )}
                        {/* 叠层的动作流水：只给「为什么突然消失」这类问题用，所以折叠起来，
                            平时不占地方。新的在前，最多 40 条（原生那边是个环形缓冲）。 */}
                        {overlayEventLog.length > 0 && (
                            <details className="px-4 pb-3">
                                <summary
                                    className="cursor-pointer text-xs leading-relaxed opacity-70"
                                    style={{ color: 'var(--text-secondary)' }}
                                >
                                    {t('options.wallpaperOverlayEventLog', { count: overlayEventLog.length })}
                                </summary>
                                <pre
                                    className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap break-all rounded-lg px-2 py-1.5 font-mono text-[10px] leading-relaxed"
                                    style={{
                                        color: 'var(--text-secondary)',
                                        backgroundColor: 'color-mix(in srgb, var(--text-primary) 6%, transparent)',
                                    }}
                                >
                                    {overlayEventLog.join('\n')}
                                </pre>
                            </details>
                        )}
                        {/* 跟随 + 叠层时，原生那层的歌词/进度条要不要让位。 */}
                        <SettingsRow
                            title={t('options.wallpaperOverlayHideNativeLyrics')}
                            description={t('options.wallpaperOverlayHideNativeLyricsDesc')}
                            dividerClass={dividerClass}
                            control={(
                                <button
                                    type="button"
                                    onClick={() => onToggleWallpaperOverlayHideNativeLyrics(!wallpaperOverlayHideNativeLyrics)}
                                    className={`h-6 w-12 shrink-0 rounded-full p-1 transition-colors ${!wallpaperOverlayHideNativeLyrics ? toggleOffBackgroundClass : ''}`}
                                    style={{ backgroundColor: wallpaperOverlayHideNativeLyrics ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                >
                                    <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${wallpaperOverlayHideNativeLyrics ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            )}
                        />
                        {/* 暂停时是否收起叠层。 */}
                        <SettingsRow
                            title={t('options.wallpaperOverlayHideWhenPaused')}
                            description={t('options.wallpaperOverlayHideWhenPausedDesc')}
                            dividerClass={dividerClass}
                            control={(
                                <button
                                    type="button"
                                    onClick={() => onToggleWallpaperOverlayHideWhenPaused(!wallpaperOverlayHideWhenPaused)}
                                    className={`h-6 w-12 shrink-0 rounded-full p-1 transition-colors ${!wallpaperOverlayHideWhenPaused ? toggleOffBackgroundClass : ''}`}
                                    style={{ backgroundColor: wallpaperOverlayHideWhenPaused ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                >
                                    <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${wallpaperOverlayHideWhenPaused ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            )}
                        />
                        {/* 歌词唱完之后（长尾奏）是否收起叠层。 */}
                        <SettingsRow
                            title={t('options.wallpaperOverlayHideAfterLyricsEnd')}
                            description={t('options.wallpaperOverlayHideAfterLyricsEndDesc')}
                            dividerClass={dividerClass}
                            control={(
                                <button
                                    type="button"
                                    onClick={() => onToggleWallpaperOverlayHideAfterLyricsEnd(!wallpaperOverlayHideAfterLyricsEnd)}
                                    className={`h-6 w-12 shrink-0 rounded-full p-1 transition-colors ${!wallpaperOverlayHideAfterLyricsEnd ? toggleOffBackgroundClass : ''}`}
                                    style={{ backgroundColor: wallpaperOverlayHideAfterLyricsEnd ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                >
                                    <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${wallpaperOverlayHideAfterLyricsEnd ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            )}
                        />
                        {/*
                          叠层里的封面要不要显示。

                          默认隐藏：封面是一整块不透明的方形图，挂在叠层上就把底下的原生壁纸
                          糊掉一大块，而叠层存在的意义恰恰是透出壁纸。想要莫奈那套完整构图的
                          再关掉这一项。
                        */}
                        <SettingsRow
                            title={t('options.wallpaperOverlayHideCoverArt')}
                            description={t('options.wallpaperOverlayHideCoverArtDesc')}
                            dividerClass={dividerClass}
                            control={(
                                <button
                                    type="button"
                                    onClick={() => onToggleWallpaperOverlayHideCoverArt(!wallpaperOverlayHideCoverArt)}
                                    className={`h-6 w-12 shrink-0 rounded-full p-1 transition-colors ${!wallpaperOverlayHideCoverArt ? toggleOffBackgroundClass : ''}`}
                                    style={{ backgroundColor: wallpaperOverlayHideCoverArt ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                >
                                    <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${wallpaperOverlayHideCoverArt ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            )}
                        />
                        {/* 纯音乐（没有歌词）时是否显示叠层。 */}
                        <SettingsRow
                            title={t('options.wallpaperOverlaySkipInstrumental')}
                            description={t('options.wallpaperOverlaySkipInstrumentalDesc')}
                            dividerClass={dividerClass}
                            control={(
                                <button
                                    type="button"
                                    onClick={() => onToggleWallpaperOverlaySkipInstrumental(!wallpaperOverlaySkipInstrumental)}
                                    className={`h-6 w-12 shrink-0 rounded-full p-1 transition-colors ${!wallpaperOverlaySkipInstrumental ? toggleOffBackgroundClass : ''}`}
                                    style={{ backgroundColor: wallpaperOverlaySkipInstrumental ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                >
                                    <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${wallpaperOverlaySkipInstrumental ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            )}
                        />
                        <SettingsRow
                            title={t('options.wallpaperOverlayHideNativeProgress')}
                            description={t('options.wallpaperOverlayHideNativeProgressDesc')}
                            dividerClass={dividerClass}
                            control={(
                                <button
                                    type="button"
                                    onClick={() => onToggleWallpaperOverlayHideNativeProgress(!wallpaperOverlayHideNativeProgress)}
                                    className={`h-6 w-12 shrink-0 rounded-full p-1 transition-colors ${!wallpaperOverlayHideNativeProgress ? toggleOffBackgroundClass : ''}`}
                                    style={{ backgroundColor: wallpaperOverlayHideNativeProgress ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                >
                                    <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${wallpaperOverlayHideNativeProgress ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            )}
                        />
                        <SettingsRow
                            title={t('options.lyricsWallpaperBackground')}
                            description={t('options.lyricsWallpaperBackgroundDesc')}
                            dividerClass={dividerClass}
                            control={(
                                <div className="flex items-center gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--text-secondary)' }}>
                                    {(['cover', 'color', 'image', 'video'] as const).map((mode) => (
                                        <button
                                            key={mode}
                                            type="button"
                                            onClick={() => onSetLyricsWallpaperBackground(mode)}
                                            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${lyricsWallpaperBackground === mode ? '' : 'opacity-60'}`}
                                            style={lyricsWallpaperBackground === mode
                                                ? { backgroundColor: theme?.accentColor || '#3b82f6', color: '#fff' }
                                                : { color: 'var(--text-primary)' }}
                                        >
                                            {t(BACKGROUND_LABEL_KEYS[mode])}
                                        </button>
                                    ))}
                                </div>
                            )}
                        >
                            {lyricsWallpaperBackground === 'image' && (
                                <div className="mt-3 flex items-center gap-3">
                                    {lyricsWallpaperImage ? (
                                        <img
                                            src={lyricsWallpaperImage}
                                            alt=""
                                            className="h-14 w-14 shrink-0 rounded-lg object-cover"
                                        />
                                    ) : (
                                        <div
                                            className="h-14 w-14 shrink-0 rounded-lg border"
                                            style={{ borderColor: 'var(--text-secondary)' }}
                                        />
                                    )}
                                    <div className="space-y-2">
                                        <button
                                            type="button"
                                            onClick={() => imageInputRef.current?.click()}
                                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${utilityGhostButtonClass}`}
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            {t('options.lyricsWallpaperPickImage')}
                                        </button>
                                        {lyricsWallpaperImage && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                onSetLyricsWallpaperImage(null);
                                                void clearWallpaperBackgroundImage();
                                            }}
                                                className="block text-xs opacity-60 hover:opacity-100"
                                                style={{ color: 'var(--text-secondary)' }}
                                            >
                                                {t('options.lyricsWallpaperClearImage')}
                                            </button>
                                        )}
                                        <input
                                            ref={imageInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={handleWallpaperImagePick}
                                        />
                                    </div>
                                </div>
                            )}
                            {lyricsWallpaperBackground === 'video' && (
                                <div className="mt-3 flex items-center gap-3">
                                    <div
                                        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border"
                                        style={{ borderColor: 'var(--text-secondary)' }}
                                    >
                                        <Video className="h-6 w-6 opacity-60" />
                                    </div>
                                    <div className="space-y-2">
                                        <button
                                            type="button"
                                            onClick={() => void handlePickVideo()}
                                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${utilityGhostButtonClass}`}
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            {t(hasVideo
                                                ? 'options.lyricsWallpaperReplaceVideo'
                                                : 'options.lyricsWallpaperPickVideo')}
                                        </button>
                                        {hasVideo && (
                                            <button
                                                type="button"
                                                onClick={() => void handleClearVideo()}
                                                className="block text-xs opacity-60 hover:opacity-100"
                                                style={{ color: 'var(--text-secondary)' }}
                                            >
                                                {t('options.lyricsWallpaperClearVideo')}
                                            </button>
                                        )}
                                        <p className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                            {t('options.lyricsWallpaperVideoDesc')}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </SettingsRow>
                        <SettingsRow
                            title={t('options.lyricsWallpaperBlur')}
                            description={t('options.lyricsWallpaperBlurDesc')}
                            dividerClass={dividerClass}
                        >
                            <div className="space-y-3">
                                <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                                    <span className="opacity-60">{t('options.lyricsWallpaperBlurValue')}</span>
                                    <span className="font-mono opacity-70">{Math.round(lyricsWallpaperBlur * 100)}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    step="5"
                                    value={Math.round(lyricsWallpaperBlur * 100)}
                                    onChange={(event) => onSetLyricsWallpaperBlur(Number(event.target.value) / 100)}
                                    className={rangeInputClass}
                                    aria-label={t('options.lyricsWallpaperBlurValue')}
                                />
                            </div>
                        </SettingsRow>
                        <SettingsRow
                            title={t('options.lyricsWallpaperProgress')}
                            description={t('options.lyricsWallpaperProgressDesc')}
                            control={renderToggle(lyricsWallpaperProgress, () => onToggleLyricsWallpaperProgress(!lyricsWallpaperProgress))}
                            dividerClass={dividerClass}
                        />
                        <SettingsRow
                            title={t('options.lyricsWallpaperTranslation')}
                            description={t('options.lyricsWallpaperTranslationDesc')}
                            control={renderToggle(lyricsWallpaperTranslation, () => onToggleLyricsWallpaperTranslation(!lyricsWallpaperTranslation))}
                            dividerClass={dividerClass}
                        />
                        <SettingsRow
                            title={t('options.lyricsWallpaperFont')}
                            description={t('options.lyricsWallpaperFontDesc')}
                            control={(
                                <button
                                    type="button"
                                    onClick={() => void handlePickWallpaperFont()}
                                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${utilityGhostButtonClass}`}
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {hasWallpaperFont
                                        ? t('options.lyricsWallpaperReplaceFont')
                                        : t('options.lyricsWallpaperPickFont')}
                                </button>
                            )}
                            dividerClass={dividerClass}
                        >
                            <div className="mt-2 flex items-center gap-3">
                                <span
                                    className="text-xs"
                                    style={{
                                        color: fontNotice === 'rejected'
                                            ? 'var(--danger-color, #ef4444)'
                                            : 'var(--text-secondary)',
                                    }}
                                >
                                    {fontNotice === 'applied'
                                        ? t('options.lyricsWallpaperFontApplied')
                                        : fontNotice === 'rejected'
                                            ? t('options.lyricsWallpaperFontFailed')
                                            : ''}
                                </span>
                                {hasWallpaperFont && (
                                    <button
                                        type="button"
                                        onClick={handleClearWallpaperFont}
                                        className="text-xs opacity-60 hover:opacity-100"
                                        style={{ color: 'var(--text-secondary)' }}
                                    >
                                        {t('options.lyricsWallpaperClearFont')}
                                    </button>
                                )}
                            </div>
                        </SettingsRow>
                        <SettingsRow
                            title={t('options.lyricsWallpaperFeed')}
                            description={t('options.lyricsWallpaperFeedDesc')}
                            control={renderToggle(lyricsWallpaperFeed, () => onToggleLyricsWallpaperFeed(!lyricsWallpaperFeed))}
                            dividerClass={dividerClass}
                            isLast
                        />
                    </div>
                </SettingsAnchor>
            )}

            <ThemedDialog
                isOpen={isNativeBlurNoticeOpen}
                onClose={() => setIsNativeBlurNoticeOpen(false)}
                isDaylight={isDaylight}
                title={t('options.nativeBlurConfirmTitle')}
                footer={(
                    <>
                        <button
                            type="button"
                            onClick={() => setIsNativeBlurNoticeOpen(false)}
                            className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${utilityGhostButtonClass}`}
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {t('localMusic.cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={confirmNativeBlur}
                            className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                            style={{ backgroundColor: theme?.accentColor || '#3b82f6' }}
                        >
                            {t('options.nativeBlurConfirmAction')}
                        </button>
                    </>
                )}
            >
                <p className="text-sm leading-6 opacity-75" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.nativeBlurConfirmDesc')}
                </p>
            </ThemedDialog>
        </div>
    );
};

export default GraphicsSettingsSubview;
