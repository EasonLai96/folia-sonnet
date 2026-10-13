import type { VisualizerTuningBundle } from '../../components/visualizer/tuningRegistry';
import type { Line, Theme } from '../../types';

// src/services/videoExport/exportConfig.ts
// 主应用与离屏渲染页之间那一份「这一条片子拍什么」的约定。
//
// 为什么走 localStorage 而不是直接传参：渲染页是**另一个 WebView / document**
// （export.html），它和主应用之间没有 Capacitor 桥 —— 渲染页那边什么桥都没有，
// 主应用也没有它的句柄可以调。两端唯一共享的东西是 origin（都是 https://localhost）
// 下面的 localStorage，所以主应用写、渲染页读。
//
// 这个模块单独存在（而不是放在渲染页那个入口里导出）是为了让主应用**不用 import 入口文件**：
// 入口文件一被引入就会建 root、引整份样式表，把渲染页的整个依赖树拖进主应用。

export const EXPORT_CONFIG_STORAGE_KEY = 'folia_export_config_v1';

export type ExportRenderConfig = {
    lyricData: { lines: Line[] } | null;
    visualizerMode: string;
    visualizerTunings?: VisualizerTuningBundle | null;
    theme: Theme | null;
    songMeta: { title?: string; artist?: string } | null;
    startSec?: number;
    /** 'theme' 铺主题底色（不透明导出）；'none' 保持透明（留给以后出 alpha）。 */
    backgroundMode?: 'none' | 'theme';
    width?: number;
    height?: number;
};

/** 主应用侧写。写在开始导出之前，渲染页一挂载就能读到。 */
export const writeExportRenderConfig = (config: ExportRenderConfig): boolean => {
    try {
        window.localStorage.setItem(EXPORT_CONFIG_STORAGE_KEY, JSON.stringify(config));
        return true;
    } catch {
        // 配额 / 隐私模式：写不进去渲染页就没有歌词，但流程还是要继续（至少能报出来）。
        return false;
    }
};

/** 渲染页侧读。解析不了当没有配置（渲染页会退回内置主题 + 占位歌词）。 */
export const readExportRenderConfig = (): ExportRenderConfig | null => {
    try {
        const raw = window.localStorage.getItem(EXPORT_CONFIG_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as ExportRenderConfig;
    } catch {
        return null;
    }
};
