import { useEffect } from 'react';
import { installVideoExportBridge } from '../services/videoExport/controller';

// src/hooks/useVideoExportBridge.ts
// 导出那条「每帧一次握手」的驱动，常驻在 App 里。
//
// 不能挂在控制面板那一页上：导出期间面板必须关掉（PixelCopy 抓的是整个窗口，
// 面板只要还在画面上就会被录进去），而面板一关它里面的监听就跟着卸载了 ——
// 原生每一帧都等不到回报，录出来是一串空帧。

export const useVideoExportBridge = (): void => {
    useEffect(() => installVideoExportBridge(), []);
};
