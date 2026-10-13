// src/components/wall/revealRect.ts

import { SEAM_EDGE_MARGIN, getSeamSplitOffsets } from './seamPlan';
import type { WallMetrics } from './layout';
import { getViewLineX, type WallView, type WallViewCenter } from './wallView';

// Smallest camera move that brings a world rect fully on screen, while keeping an open split on
// screen when both fit (the prototype's `revealRect`). The split rides with the world, so a move
// that pushed it off an edge would also squeeze it shut; between "rect visible" and "split stays",
// the rect wins. Vertically the rect clears `bottomInset` - the player bar's safe area.

export type RevealRect = { x: number; y: number; width: number; height: number };

export type RevealInput = {
    rect: RevealRect;
    /** Current view centre (world point under the split's base line). */
    center: WallViewCenter;
    view: WallView;
    metrics: WallMetrics;
    /** World x of the split; null when the layer has none. */
    anchorX: number | null;
    /** Opening the split is drawn at right now, in screen px (0 when shut). */
    seamWidth: number;
    /** Screen-px margin kept around the rect. */
    pad?: number;
    /** Screen px the rect's bottom edge must stay above (player bar safe area); defaults to pad. */
    bottomInset?: number;
    /**
     * 相机落到这一段区间的哪里：
     *
     * - `minimal`（默认）：**最小平移**。矩形已经完整可见时相机一动不动，只在它被挡着的时候
     *   把它挪进来。适合键盘焦点移动、「顺手露一下」这类被动场合 —— 手没动，画面也不该跳。
     * - `centered`：**居中**。一律落到「它在哪都行」这段区间的中点，看得见的位移。
     *   适合「定位正在播放」这种用户明确点名要看的东西 —— 这时候再给最小平移，
     *   卡片刚好在屏幕边上就成了「只选中了、什么都没发生」。
     */
    mode?: 'minimal' | 'centered';
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** View centre after the minimal move; equal to `center` when the rect already shows. */
export const resolveRevealCenter = ({
    rect,
    center,
    view,
    metrics,
    anchorX,
    seamWidth,
    pad = 24,
    bottomInset = pad,
    mode = 'minimal',
}: RevealInput): WallViewCenter => {
    // 两个 place 的区别只有「落在区间哪里」：minimal 尽量贴着当前 center，centered 取区间中点。
    const place = (low: number, high: number, fallbackLow: number, fallbackHigh: number, current: number): number => {
        if (mode === 'centered') {
            return low <= high ? (low + high) / 2 : (fallbackLow + fallbackHigh) / 2;
        }
        return low <= high
            ? clamp(current, low, high)
            : clamp(current, Math.min(fallbackLow, fallbackHigh), Math.max(fallbackLow, fallbackHigh));
    };
    const lineX = getViewLineX(view);
    const scale = view.scale;
    const hasSeam = anchorX !== null && seamWidth > 1;
    // The half the rect sits in is pushed away from the split; screen x = line + offset + (x - cx) * s.
    const offsets = hasSeam ? getSeamSplitOffsets(seamWidth, scale, metrics) : { left: 0, right: 0 };
    const rectCenterX = rect.x + rect.width / 2;
    const offset = anchorX !== null && rectCenterX < anchorX ? offsets.left : offsets.right;

    const fitLow = rect.x + rect.width - (view.width - pad - lineX - offset) / scale;
    const fitHigh = rect.x - (pad - lineX - offset) / scale;
    let x: number;
    if (hasSeam) {
        const need = seamWidth / 2 + SEAM_EDGE_MARGIN;
        const seamLow = anchorX! - (view.width - need - lineX) / scale;
        const seamHigh = anchorX! + (lineX - need) / scale;
        // 优先保住缝（`low..high` 是「矩形进得来」与「缝还在屏内」的交集）；交集为空时退回到只看矩形。
        x = place(Math.max(fitLow, seamLow), Math.min(fitHigh, seamHigh), fitLow, fitHigh, center.x);
    } else {
        x = place(fitLow, fitHigh, fitLow, fitHigh, center.x);
    }

    const yLow = rect.y + rect.height - (view.height / 2 - bottomInset) / scale;
    const yHigh = rect.y - (pad - view.height / 2) / scale;
    // 矩形比可视区还高时区间为空，两种模式都退回「无视边距把矩形中心对到屏幕中心」。
    const y = yLow <= yHigh
        ? (mode === 'centered' ? (yLow + yHigh) / 2 : clamp(center.y, yLow, yHigh))
        : rect.y + rect.height / 2;
    return { x, y };
};
