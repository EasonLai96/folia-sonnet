import { advanceOf, isWideChar, type PlacedItem } from './nebbiaBlocks';
import type { NebbiaSourceLine } from './nebbiaChars';

// Long unbreakable words need a grapheme-safe fallback instead of shrinking the whole sentence into one tiny row.
export interface NebbiaReadableLayout { items: PlacedItem[]; size: number }

export const readableNebbiaRows = (
    line: NebbiaSourceLine, width: number, height: number, preferredSize: number,
): NebbiaReadableLayout => {
    const availableW = Math.max(1, width), availableH = Math.max(1, height);
    const advance = (ch: string) => ch.trim()
        ? Math.max(advanceOf(ch), isWideChar(ch) ? 1.1 : 1) * (isWideChar(ch) ? 1 : 1.15)
        : 0.4;
    const wrap = (size: number) => {
        const rows: { k: number; x: number; w: number }[][] = [[]];
        let pen = 0;
        line.chars.forEach(({ ch }, k) => {
            const w = advance(ch);
            if (pen > 0 && (pen + w) * size > availableW) { rows.push([]); pen = 0; }
            rows[rows.length - 1].push({ k, x: pen + w / 2, w });
            pen += w;
        });
        return rows;
    };
    let size = Math.min(Math.max(1, preferredSize), availableW / 1.15);
    let rows = wrap(size);
    // Fit is monotone: binary search avoids making a larger requested font smaller through coarse shrink steps.
    if (rows.length * size * 1.5 > availableH) {
        let low = 0, high = size;
        for (let attempt = 0; attempt < 32; attempt += 1) {
            const mid = (low + high) / 2;
            if (wrap(mid).length * mid * 1.5 <= availableH) low = mid;
            else high = mid;
        }
        size = low;
        rows = wrap(size);
    }
    const items = rows.flatMap((row, ri) => {
        const rowWidth = row.reduce((sum, item) => sum + item.w, 0);
        return row.map(({ k, x }) => ({ k, x: x - rowWidth / 2, y: ri * 1.5, s: 1, rot: 0 }));
    });
    return { items, size };
};
