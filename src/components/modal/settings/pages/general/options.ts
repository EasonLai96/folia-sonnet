import { isCapacitorAndroid } from '../../../../../platform/runtime';
import { option, type SettingsGroupDef } from '../../../kit';

// src/components/modal/settings/pages/general/options.ts
// The groups and options of the 通用 page, declared apart from the page so the files that draw its
// rows name the same ones. The 安卓 group's one row is drawn by its own component
// (AndroidScreenAwakeSetting), which is why it is declared here rather than in the page.
//
// `noteKey` carries the row's explanation — kept behind the "i", not printed under the label — and
// is the text the settings search matches it by.

export const LANGUAGE: SettingsGroupDef = { id: 'languageSettings', titleKey: 'options.languageSettings' };
export const LAUNCH: SettingsGroupDef = { id: 'labWindowAndTools', titleKey: 'options.settingsHeadingLaunch' };
export const UPDATE: SettingsGroupDef = { id: 'updateCheck', titleKey: 'options.updateCheck', electronOnly: true };
export const PONDER: SettingsGroupDef = { id: 'ponderHints', titleKey: 'options.ponderHints' };

/**
 * 安卓专有那一项（fork 独有）：屏幕常亮。
 *
 * 显示那几项（毛玻璃 / 歌词扁平 / 设备类型 / 手机适配）搬去了外观页，Lyricon 搬去了
 * 「连接与集成」页 —— 都是「看」的东西，堆在通用页里只是因为以前那里挂的是老式卡片。
 * 整组只有安卓才画（组件自己也判一次运行时），所以靠 `available` 让它在桌面端连同这张
 * 空卡、带这一条搜索结果一起退场。
 */
export const ANDROID: SettingsGroupDef = {
    id: 'androidSettings',
    titleKey: 'options.androidSettings',
    available: isCapacitorAndroid,
};

export const O = {
    language: option(LANGUAGE, 'appLanguage', 'options.appLanguage'),
    autoPlay: option(LAUNCH, 'autoPlayOnLaunch', 'options.autoPlayOnLaunch'),
    openPlayer: option(LAUNCH, 'openPlayerOnLaunch', 'options.openPlayerOnLaunch', { electronOnly: true }),
    titlebarButtons: option(LAUNCH, 'alwaysShowMainWindowTitlebar', 'options.alwaysShowMainWindowTitlebar'),
    updateCheck: option(UPDATE, 'enableUpdateCheck', 'options.enableUpdateCheck'),
    autoUpdate: option(UPDATE, 'enableAutoUpdate', 'options.enableAutoUpdate'),
    updateChannel: option(UPDATE, 'updateChannel', 'options.updateChannel'),
    ponderHints: option(PONDER, 'ponderHintVisibility', 'options.ponderHints'),
    ponderTouchButton: option(PONDER, 'ponderTouchButton', 'options.ponderTouchButton'),
    keepScreenAwake: option(ANDROID, 'keepScreenAwake', 'options.keepScreenAwake', {
        noteKey: 'options.keepScreenAwakeDesc',
        available: isCapacitorAndroid,
    }),
};
