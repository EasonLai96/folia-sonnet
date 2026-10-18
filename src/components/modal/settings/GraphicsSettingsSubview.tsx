import React, { useState } from 'react';
import { Gauge, MonitorCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Theme, VisualizerFrameRate } from '../../../types';
import { VISUALIZER_FRAME_RATE_OPTIONS } from '../../../utils/frameRateLimiter';
import { DEFAULT_RENDER_PIXEL_RATIO, RENDER_PIXEL_RATIO_OPTIONS } from '../../../utils/renderPixelRatio';
import { useDevicePixelRatio } from '../../../hooks/useMediaQuery';
import ThemedDialog from '../../shared/ThemedDialog';
import { SettingsAnchor } from './navigation/SettingsAnchorContext';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';
import MotionReductionSettingsSection from './MotionReductionSettingsSection';
import SettingsRow, { SettingsToggle } from './SettingsRow';
import { settingsDividerClassFor } from './settingsCardClasses';
import { useThemeSettingsStore } from '../../../stores/useThemeSettingsStore';
import { usePlayerChromeSettingsStore } from '../../../stores/usePlayerChromeSettingsStore';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';

// src/components/modal/settings/GraphicsSettingsSubview.tsx
// Everything that trades picture for smoothness or works around a renderer problem: static mode,
// the home background, native blur, the render-resolution cap, the frame-rate cap, the Linux glow
// fix and reduced motion. Moved out of the lab page, where these sat among unrelated
// player-chrome switches.
//
// 歌词动态壁纸那一节以前也在这里 —— 它是 Android 专有的，最早跟着「省电 / 掉帧」这类
// 开关一起进来的。但它管的是**歌词长什么样**（小窗位置、字号、叠层让不让位），跟帧率、
// 静态模式不是一回事，搬去「外观 → 歌词动画」了（LyricsWallpaperSettingsSection）。

/** Docs page behind the "Fix lyric animation freeze on Linux" switch. */
const CHROMIUM_FD_EXHAUSTION_DOCS_URL = 'https://folia-site.cielaniska.top/guide/chromium-fd-exhaustion';

/** On desktop a plain link would open inside the app window; hand it to the system browser instead. */
const openDocsLinkExternally = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!window.electron?.openExternalUrl) return;
    event.preventDefault();
    void window.electron.openExternalUrl(event.currentTarget.href);
};

const getFrameRateLabel = (frameRate: VisualizerFrameRate) => `${frameRate} FPS`;

/** 画到几位小数：0.75 / 1 / 1.5 / 1.33 这些档位都要能一眼认出来，尾随零不要。 */
const getRenderPixelRatioLabel = (pixelRatio: number) => `×${Number(pixelRatio.toFixed(2))}`;

/**
 * 打开开关时落在哪一档。
 *
 * 不能给 120：屏幕刷新率最多也就 120，限 120 和不限画出来是一模一样的两份 —— 以前默认给 120，
 * 于是「打开帧率限制」这一步看不出任何变化，用户只能以为开关坏了。给 60：一开就能看出来，
 * 想要满帧再往上拉到 120。
 */
const DEFAULT_VISUALIZER_FRAME_RATE: VisualizerFrameRate = 60;

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
    const renderPixelRatio = useVisualizerSettingsStore(state => state.renderPixelRatio);
    const onRenderPixelRatioChange = useVisualizerSettingsStore(state => state.handleSetRenderPixelRatio);
    const devicePixelRatio = useDevicePixelRatio();
    const glowBlurQuantize = useVisualizerSettingsStore(state => state.glowBlurQuantize);
    const onToggleGlowBlurQuantize = useVisualizerSettingsStore(state => state.handleToggleGlowBlurQuantize);

    const dividerClass = settingsDividerClassFor(isDaylight);
    const isLinux = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('linux');
    const isVisualizerFrameRateLimiterEnabled = visualizerFrameRate !== 'off';
    // 关着的时候档位显示 120：那正是「不限」的意思 —— 画到屏幕刷新率为止。
    const selectedVisualizerFrameRate = isVisualizerFrameRateLimiterEnabled ? visualizerFrameRate : 120;
    const selectedVisualizerFrameRateIndex = VISUALIZER_FRAME_RATE_OPTIONS.indexOf(selectedVisualizerFrameRate);

    const isRenderPixelRatioLimited = renderPixelRatio !== null;
    // 关着的时候滑块停在默认档，打开的瞬间就落在这一档；右边的数值显示的却是**当前生效**的
    // 像素比（跟随屏幕时就是屏幕自己的值），所以关/开两边都不会出现「显示的数和画面对不上」。
    const selectedRenderPixelRatio = isRenderPixelRatioLimited ? renderPixelRatio : DEFAULT_RENDER_PIXEL_RATIO;
    const selectedRenderPixelRatioIndex = RENDER_PIXEL_RATIO_OPTIONS.indexOf(selectedRenderPixelRatio);
    const renderPixelRatioLabel = getRenderPixelRatioLabel(
        isRenderPixelRatioLimited ? selectedRenderPixelRatio : devicePixelRatio,
    );

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

    const handleRenderPixelRatioSliderChange = (value: string) => {
        const nextIndex = Math.min(RENDER_PIXEL_RATIO_OPTIONS.length - 1, Math.max(0, Number(value)));
        onRenderPixelRatioChange(RENDER_PIXEL_RATIO_OPTIONS[nextIndex]);
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
                        title={t('options.renderPixelRatio')}
                        description={t('options.renderPixelRatioDesc')}
                        control={renderToggle(
                            isRenderPixelRatioLimited,
                            () => onRenderPixelRatioChange(isRenderPixelRatioLimited ? null : DEFAULT_RENDER_PIXEL_RATIO),
                        )}
                        dividerClass={dividerClass}
                    >
                        <div className={`space-y-3 transition-opacity ${isRenderPixelRatioLimited ? 'opacity-100' : 'opacity-45 pointer-events-none'}`}>
                            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                                <span className="opacity-60">{t('options.renderPixelRatioValue')}</span>
                                <span className="font-mono opacity-70">{renderPixelRatioLabel}</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max={RENDER_PIXEL_RATIO_OPTIONS.length - 1}
                                step="1"
                                value={Math.max(0, selectedRenderPixelRatioIndex)}
                                onChange={(event) => handleRenderPixelRatioSliderChange(event.target.value)}
                                className={rangeInputClass}
                                aria-label={t('options.renderPixelRatioValue')}
                                disabled={!isRenderPixelRatioLimited}
                            />
                            {/* 档位可能变（现在 0.5..2 六档），刻度用两端对齐而不是写死的几列。 */}
                            <div className="flex justify-between text-[11px] font-mono opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {RENDER_PIXEL_RATIO_OPTIONS.map(pixelRatio => (
                                    <span key={pixelRatio}>{pixelRatio}</span>
                                ))}
                            </div>
                        </div>
                    </SettingsRow>
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
