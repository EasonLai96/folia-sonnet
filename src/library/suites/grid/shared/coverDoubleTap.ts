import { useRef } from 'react';

// src/library/suites/grid/shared/coverDoubleTap.ts
// 双击封面 = 按那颗播放键。
//
// 为什么要有这条手势：横屏时网格整体往下压，居中那张卡的播放键会落到底部进度条底下 ——
// 键还在、`pointer-events` 也还是 auto，只是手指按不到它。双击封面是那条路走不通时的替补。

/** 两次点击算一次双击的最长间隔。比系统双击判定宽一点：手指点两下比鼠标慢。 */
export const DOUBLE_TAP_MS = 340;
/** 两次点击之间允许的位移：手指双击不可能落在同一个像素上，但没有这条又会把一次拖动的尾点算进来。 */
export const DOUBLE_TAP_SLOP_PX = 24;

export type TapPoint = { at: number; x: number; y: number };

/** 点击事件的那一小部分形状：够用，也让这个模块不必认识 React 的事件类型。 */
export type TapEvent = {
    clientX: number;
    clientY: number;
    stopPropagation: () => void;
};

/** 纯判定（抽出来是为了能脱开组件单测）：上一次点击和这一次能不能算一次双击。 */
export const isDoubleTap = (previous: TapPoint | null, next: TapPoint): boolean => {
    if (!previous) return false;
    const gap = next.at - previous.at;
    // 上一次比这一次还晚（时钟回拨、或同一次点击的两条事件乱了序）不是双击。
    if (gap < 0 || gap > DOUBLE_TAP_MS) return false;
    return Math.abs(next.x - previous.x) <= DOUBLE_TAP_SLOP_PX
        && Math.abs(next.y - previous.y) <= DOUBLE_TAP_SLOP_PX;
};

/**
 * 自己数两次 `click`，而不是用 `onDoubleClick`：安卓 WebView 里 `dblclick` 在
 * `touch-action: none` 的画布上不一定落得下来，而 `click` 一定会有（手指点一下浏览器就发，
 * 不论那块区域有没有声明手势）。
 *
 * 第一次点击照旧交给卡片（居中），只有凑成双击的那一次才被拦下来 —— 所以双击之后
 * 卡片不会被再居中一次，也不会把这一次点击当成又一次「选中」传上去。
 */
export const useCoverDoubleTap = (enabled: boolean, onDoubleTap: () => void) => {
    const lastTap = useRef<TapPoint | null>(null);
    return (event: TapEvent): void => {
        if (!enabled) return;
        const now: TapPoint = { at: Date.now(), x: event.clientX, y: event.clientY };
        const previous = lastTap.current;
        lastTap.current = now;
        if (!isDoubleTap(previous, now)) return;
        lastTap.current = null;
        event.stopPropagation();
        onDoubleTap();
    };
};
