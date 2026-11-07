import { clamp } from './nebbiaConstants';

// Keep the broad finger-writing floor on large letters without letting it fill the counters of small mobile glyphs.
export const nebbiaInkWidth = (strokeWidth: number, size: number, strokes: number): number => {
    const thin = clamp(Math.sqrt(9 / Math.max(1, strokes)), 0.55, 1);
    const minimumPixels = Math.min(8, Math.max(0, size) * 0.04);
    return Math.max(strokeWidth, minimumPixels / Math.max(1, size)) * thin;
};
