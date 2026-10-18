import React, { useState } from 'react';
import { Store, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SettingsRow from './SettingsRow';
import { settingsDividerClassFor } from './settingsCardClasses';
import { Button, Reveal, Segmented, Toggle } from './kit';
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
    setWallpaperFont,
} from '../../../platform/foliaWallpaper';
import FontMarketDialog from '../FontMarketDialog';
import {
    readFontMarketChoice,
    type FontMarketSelection,
} from '../../../services/fontMarket';
import type { WallpaperLockScreenStatus } from '../../../platform/foliaWallpaper';

// src/components/modal/settings/LyricsWallpaperSettingsSection.tsx
// 歌词动态壁纸那一整节：设为壁纸、样式（跟随 / 精简小窗）、可视化叠层、背景（封面 /
// 纯色 / 图片 / 视频）、字体。Android 专有 —— 其它平台整节不渲染。
//
// 以前它挂在「图形设置」里，因为最早是作为「要不要省电 / 掉帧」这类开关进来的。
// 但它管的是**歌词长什么样**（小窗位置、字号、叠层让不让位），跟帧率、静态模式这些
// 不是一回事；放在图形设置里，调歌词样式的人根本找不到。所以整节搬到「外观 → 歌词
// 动画」，跟「歌词动画样式」那个入口挨在一起。

/** 壁纸背景四种模式的文案键。列成一张表，加一种模式时只改这一处。 */
const BACKGROUND_LABEL_KEYS: Record<'cover' | 'color' | 'image' | 'video', string> = {
    cover: 'options.lyricsWallpaperBackgroundCover',
    color: 'options.lyricsWallpaperBackgroundColor',
    image: 'options.lyricsWallpaperBackgroundImage',
    video: 'options.lyricsWallpaperBackgroundVideo',
};

type LyricsWallpaperSettingsSectionProps = {
    isDaylight: boolean;
    rangeInputClass: string;
};

const LyricsWallpaperSettingsSection: React.FC<LyricsWallpaperSettingsSectionProps> = ({
    isDaylight,
    rangeInputClass,
}) => {
    const { t } = useTranslation();
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
    // 歌词字体的来路：跟随播放页 / 单独指定。只有「单独」才需要那个选字体的按钮。
    const wallpaperLyricsFontMode = useVisualizerSettingsStore(
        state => state.wallpaperLyricsFontMode);
    const onSetWallpaperLyricsFontMode = useVisualizerSettingsStore(
        state => state.handleSetWallpaperLyricsFontMode);
    // 预览：在 App 里也把那层小窗挂出来（正常逻辑在 App 里不挂，设置页就什么都看不见）。
    const onSetWallpaperFloatingPreview = useVisualizerSettingsStore(
        state => state.handleSetWallpaperFloatingPreview);
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
    const [isFontMarketOpen, setIsFontMarketOpen] = useState(false);
    const [fontMarketChoice, setFontMarketChoice] = useState(() => readFontMarketChoice());

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

    /*
     * 预览：只要这一页挂着，就让原生那层悬浮小窗**在 App 里也显示出来**。
     *
     * 正常逻辑是「在应用里就不挂」（怕盖着自己的界面、播放页本来就有歌词），
     * 但调这些位置 / 大小 / 避开区域的滑条恰恰是在 App 里做的 —— 不开预览的话，
     * 拖到底屏幕上也一点反应都没有（「看不到预览界面」）。
     * 这一页是按 section 条件渲染的，卸载 = 离开设置页，预览随之关掉。
     */
    React.useEffect(() => {
        onSetWallpaperFloatingPreview(true);
        return () => {
            onSetWallpaperFloatingPreview(false);
        };
    }, [onSetWallpaperFloatingPreview]);

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

    /*
     * 从字体市场挑一款：下载字体字节 → 网页侧注册（App 里能立刻看到）→
     * 字节推给原生（壁纸 / 叠层那两层是自绘的，读不到网页注册的字体）。
     */
    const handleUseMarketFont = async (result: FontMarketSelection & { base64?: string }) => {
        try {
            await setWallpaperFont(result.base64 ?? null);
            setFontMarketChoice({
                id: result.id,
                family: result.family,
                label: result.label,
                previewUrl: result.previewUrl,
            });
            setHasWallpaperFont(true);
            setFontNotice('applied');
        } catch (error) {
            setFontNotice('rejected');
            console.warn('[FontMarket] 安装字体失败', error);
        }
        window.setTimeout(() => setFontNotice(null), 3200);
    };

    const dividerClass = settingsDividerClassFor(isDaylight);

    /* 非安卓平台整节不渲染 —— 放在 hooks 之后，订阅顺序才稳定。 */
    if (!isAndroid) return null;

    /*
     * 自己不再画标题、也不画卡：外观页用 kit 的 Group 把整节包成**独立的一张卡**
     * （跟上面「歌词动画样式」那张分开），标题由 Group 画。原来这里自己照着
     * Group 的标题画了一个 h3 还带一颗 Wallpaper 图标 —— 别的组标题都没有图标，
     * 这颗也就一并去了。
     */
    return (
        <div>
            <SettingsRow
                title={t('options.lyricsWallpaperApply')}
                    description={t('options.lyricsWallpaperApplyDesc')}
                    control={(
                        <Button onClick={handleOpenWallpaperPicker}>
                            {isWallpaperActive
                                ? t('options.lyricsWallpaperActive')
                                : t('options.lyricsWallpaperSet')}
                        </Button>
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
                        <Segmented
                            value={lyricsWallpaperStyle}
                            options={[
                                { value: 'minimal', label: t('options.lyricsWallpaperStyleMinimal') },
                                { value: 'follow', label: t('options.lyricsWallpaperStyleFollow') },
                            ]}
                            onChange={onSetLyricsWallpaperStyle}
                        />
                    )}
                />
                {/* 精简模式下歌词是那颗可以拖的小窗，拖到角落 / 缩到最小又上了锁之后
                    光靠手势弄不回来，所以这里给一颗「重置」当出口。 */}
                <Reveal when={lyricsWallpaperStyle === 'minimal'}>
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
                                <Toggle checked={wallpaperFloatingOverSafeArea} onChange={onToggleWallpaperFloatingOverSafeArea} />
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
                                    <Toggle checked={wallpaperFloatingFillSafeArea} onChange={onToggleWallpaperFloatingFillSafeArea} />
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
                                <Segmented
                                    value={wallpaperFloatingFontSizeMode}
                                    options={[
                                        { value: 'dynamic', label: t('options.floatingLyricsFontSizeDynamic') },
                                        { value: 'custom', label: t('options.floatingLyricsFontSizeCustom') },
                                    ]}
                                    onChange={onSetWallpaperFloatingFontSizeMode}
                                />
                            )}
                        />
                <Reveal when={wallpaperFloatingFontSizeMode === 'custom'}>
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
                </Reveal>
                {/* 拖到角落 / 缩到最小又上了锁之后光靠手势弄不回来，
                            所以这里给一颗「重置」当出口。 */}
                        <SettingsRow
                            title={t('options.floatingLyricsWindow')}
                            description={t('options.floatingLyricsResetDesc')}
                            dividerClass={dividerClass}
                            control={(
                                <Button onClick={handleResetFloatingLyricsWindow}>
                                    {floatingResetDone
                                        ? t('options.floatingLyricsResetDone')
                                        : t('options.floatingLyricsReset')}
                                </Button>
                            )}
                        />
                    </>
                </Reveal>
                {/* 可视化叠层要 SYSTEM_ALERT_WINDOW；没授权时它静默不工作，
                    用户只会看到「壁纸跟以前一样」，所以这里必须给明确入口。 */}
                <SettingsRow
                    title={t('options.lyricsWallpaperOverlay')}
                    description={t('options.lyricsWallpaperOverlayDesc')}
                    dividerClass={dividerClass}
                    control={(
                        <Button onClick={handleOpenOverlaySettings}>
                            {hasOverlayPermission
                                ? t('options.lyricsWallpaperOverlayGranted')
                                : t('options.lyricsWallpaperOverlayGrant')}
                        </Button>
                    )}
                />
                {/* 叠层总开关：关掉之后一层都不挂，下面几项也就没有意义了。 */}
                <SettingsRow
                    title={t('options.wallpaperOverlayEnabled')}
                    description={t('options.wallpaperOverlayEnabledDesc')}
                    dividerClass={dividerClass}
                    control={(
                        <Toggle checked={wallpaperOverlayEnabled} onChange={onToggleWallpaperOverlayEnabled} />
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
                        <Toggle checked={wallpaperOverlayAllApps} onChange={onToggleWallpaperOverlayAllApps} />
                    )}
                />
                {/* 音乐锁屏：锁屏之上也挂同一层。 */}
                <SettingsRow
                    title={t('options.wallpaperOverlayLockScreen')}
                    description={t('options.wallpaperOverlayLockScreenDesc')}
                    dividerClass={dividerClass}
                    control={(
                        <Toggle checked={wallpaperOverlayLockScreen} onChange={onToggleWallpaperOverlayLockScreen} />
                    )}
                />
                {/* 叠层只在锁屏上出现：桌面 / 所有应用 / App 内都不挂。 */}
                <SettingsRow
                    title={t('options.wallpaperOverlayLockScreenOnly')}
                    description={t('options.wallpaperOverlayLockScreenOnlyDesc')}
                    dividerClass={dividerClass}
                    control={(
                        <Toggle checked={wallpaperOverlayLockScreenOnly} onChange={onToggleWallpaperOverlayLockScreenOnly} />
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
                        <Toggle checked={wallpaperOverlayHideNativeLyrics} onChange={onToggleWallpaperOverlayHideNativeLyrics} />
                    )}
                />
                {/* 暂停时是否收起叠层。 */}
                <SettingsRow
                    title={t('options.wallpaperOverlayHideWhenPaused')}
                    description={t('options.wallpaperOverlayHideWhenPausedDesc')}
                    dividerClass={dividerClass}
                    control={(
                        <Toggle checked={wallpaperOverlayHideWhenPaused} onChange={onToggleWallpaperOverlayHideWhenPaused} />
                    )}
                />
                {/* 歌词唱完之后（长尾奏）是否收起叠层。 */}
                <SettingsRow
                    title={t('options.wallpaperOverlayHideAfterLyricsEnd')}
                    description={t('options.wallpaperOverlayHideAfterLyricsEndDesc')}
                    dividerClass={dividerClass}
                    control={(
                        <Toggle checked={wallpaperOverlayHideAfterLyricsEnd} onChange={onToggleWallpaperOverlayHideAfterLyricsEnd} />
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
                        <Toggle checked={wallpaperOverlayHideCoverArt} onChange={onToggleWallpaperOverlayHideCoverArt} />
                    )}
                />
                {/* 纯音乐（没有歌词）时是否显示叠层。 */}
                <SettingsRow
                    title={t('options.wallpaperOverlaySkipInstrumental')}
                    description={t('options.wallpaperOverlaySkipInstrumentalDesc')}
                    dividerClass={dividerClass}
                    control={(
                        <Toggle checked={wallpaperOverlaySkipInstrumental} onChange={onToggleWallpaperOverlaySkipInstrumental} />
                    )}
                />
                <SettingsRow
                    title={t('options.wallpaperOverlayHideNativeProgress')}
                    description={t('options.wallpaperOverlayHideNativeProgressDesc')}
                    dividerClass={dividerClass}
                    control={(
                        <Toggle checked={wallpaperOverlayHideNativeProgress} onChange={onToggleWallpaperOverlayHideNativeProgress} />
                    )}
                />
                <SettingsRow
                    title={t('options.lyricsWallpaperBackground')}
                    description={t('options.lyricsWallpaperBackgroundDesc')}
                    dividerClass={dividerClass}
                    control={(
                        <Segmented
                            value={lyricsWallpaperBackground}
                            options={(['cover', 'color', 'image', 'video'] as const).map(mode => ({
                                value: mode,
                                label: t(BACKGROUND_LABEL_KEYS[mode]),
                            }))}
                            onChange={onSetLyricsWallpaperBackground}
                        />
                    )}
                >
                    <Reveal when={lyricsWallpaperBackground === 'image'}>
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
                                <Button onClick={() => imageInputRef.current?.click()}>
                                    {t('options.lyricsWallpaperPickImage')}
                                </Button>
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
                    </Reveal>
                    <Reveal when={lyricsWallpaperBackground === 'video'}>
                        <div className="mt-3 flex items-center gap-3">
                            <div
                                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border"
                                style={{ borderColor: 'var(--text-secondary)' }}
                            >
                                <Video className="h-6 w-6 opacity-60" />
                            </div>
                            <div className="space-y-2">
                                <Button onClick={() => void handlePickVideo()}>
                                    {t(hasVideo
                                        ? 'options.lyricsWallpaperReplaceVideo'
                                        : 'options.lyricsWallpaperPickVideo')}
                                </Button>
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
                    </Reveal>
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
                    control={<Toggle checked={lyricsWallpaperProgress} onChange={onToggleLyricsWallpaperProgress} />}
                    dividerClass={dividerClass}
                />
                <SettingsRow
                    title={t('options.lyricsWallpaperTranslation')}
                    description={t('options.lyricsWallpaperTranslationDesc')}
                    control={<Toggle checked={lyricsWallpaperTranslation} onChange={onToggleLyricsWallpaperTranslation} />}
                    dividerClass={dividerClass}
                />
                {/* 字体来路：跟随播放页 / 单独指定。选「单独」才有下面那个选字体的按钮。 */}
                <SettingsRow
                    title={t('options.lyricsWallpaperFontMode')}
                    description={t('options.lyricsWallpaperFontModeDesc')}
                    dividerClass={dividerClass}
                    control={(
                        <Segmented
                            value={wallpaperLyricsFontMode}
                            options={[
                                { value: 'follow', label: t('options.lyricsWallpaperFontFollow') },
                                { value: 'custom', label: t('options.lyricsWallpaperFontCustom') },
                            ]}
                            onChange={onSetWallpaperLyricsFontMode}
                        />
                    )}
                />
                <Reveal when={wallpaperLyricsFontMode === 'custom'}>
                    <SettingsRow
                        title={t('options.lyricsWallpaperFont')}
                        description={t('options.lyricsWallpaperFontDesc')}
                        control={(
                            <div className="flex shrink-0 items-center gap-1.5">
                                <Button onClick={() => void handlePickWallpaperFont()}>
                                    {hasWallpaperFont
                                        ? t('options.lyricsWallpaperReplaceFont')
                                        : t('options.lyricsWallpaperPickFont')}
                                </Button>
                                <Button icon={Store} onClick={() => setIsFontMarketOpen(true)}>
                                    {t('options.fontMarket')}
                                </Button>
                            </div>
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
                </Reveal>
                <SettingsRow
                    title={t('options.lyricsWallpaperFeed')}
                    description={t('options.lyricsWallpaperFeedDesc')}
                    control={<Toggle checked={lyricsWallpaperFeed} onChange={onToggleLyricsWallpaperFeed} />}
                    dividerClass={dividerClass}
                    isLast
                />
            <FontMarketDialog
                isOpen={isFontMarketOpen}
                onClose={() => setIsFontMarketOpen(false)}
                isDaylight={isDaylight}
                currentFamily={fontMarketChoice?.family ?? null}
                onUseFont={handleUseMarketFont}
                onPickLocalFont={() => {
                    setIsFontMarketOpen(false);
                    void handlePickWallpaperFont();
                }}
            />
        </div>
    );
};

export default LyricsWallpaperSettingsSection;
