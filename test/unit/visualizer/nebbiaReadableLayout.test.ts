import { describe, expect, it } from 'vitest';
import { layoutNebbiaSong } from '../../../src/components/visualizer/nebbia/nebbiaLayout';
import { readableNebbiaRows } from '../../../src/components/visualizer/nebbia/nebbiaReadableLayout';
import type { NebbiaSourceLine } from '../../../src/components/visualizer/nebbia/nebbiaChars';

// Narrow-screen fallback must preserve each grapheme and its timing while keeping long words readable.
const source = (text: string): NebbiaSourceLine => {
    const chars = [...text].map((ch, i) => ({ ch, t: i * 0.2, d: 0.2 }));
    return { chars, words: [chars.map((_, k) => k)], t: 0, end: 8, next: Infinity };
};
const layout = (line: NebbiaSourceLine, fontScale = 1) => layoutNebbiaSong([line], {
    W: 360, H: 720, jitter: 0, layouts: ['ribbon'], fontScale,
    visibleUntil: () => 12, fogAt: () => 10,
})[0];

describe('nebbia readable fallback', () => {
    it('wraps a long unbreakable Latin word instead of shrinking it into one tiny row', () => {
        const line = source('a'.repeat(40)), before = structuredClone(line);
        const positions = layout(line);
        expect(positions).toHaveLength(40);
        expect(Math.min(...positions.map(p => p.s))).toBeGreaterThan(30);
        expect(new Set(positions.map(p => p.y)).size).toBeGreaterThan(1);
        expect(line).toEqual(before);
        for (const p of positions) {
            expect(p.x - p.s / 2).toBeGreaterThanOrEqual(17.9);
            expect(p.x + p.s / 2).toBeLessThanOrEqual(342.1);
            expect(p.y - p.s / 2).toBeGreaterThan(0);
            expect(p.y + p.s / 2).toBeLessThan(720);
        }
    });
    it('still responds to the user font scale on a narrow screen', () => {
        const line = source('a'.repeat(40));
        expect(layout(line, 1.4)[0].s).toBeGreaterThanOrEqual(layout(line, 0.85)[0].s - 1e-6);
        const shorter = source('a'.repeat(20));
        expect(layout(shorter, 1.4)[0].s).toBeGreaterThan(layout(shorter, 0.85)[0].s);
    });
    it.each(['霧鬱籤聽響讓繁體中文'.repeat(5), '👩‍🚀測試 a mixed long lyric'])('does not drop or duplicate source characters: %s', text => {
        const line = source(text), result = readableNebbiaRows(line, 288, 420, 42);
        expect(result.items.map(p => p.k)).toEqual(line.chars.map((_, k) => k));
        expect(result.items.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
        expect(result.size).toBeGreaterThan(0);
    });
    it('keeps short lines deterministic', () => {
        const line = source('短句');
        expect(layout(line)).toEqual(layout(line));
    });
});
