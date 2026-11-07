import { describe, expect, it, vi } from 'vitest';
import { buildNebbiaScene, yieldFactor, type LaidLine } from '@/components/visualizer/nebbia/nebbiaScene';
import { DEFAULT_NEBBIA_TUNING } from '@/components/visualizer/nebbia/types';
import type { NebbiaGlyphCache } from '@/components/visualizer/nebbia/nebbiaGlyphs';
import type { NebbiaSourceLine } from '@/components/visualizer/nebbia/nebbiaChars';

// test/unit/visualizer/nebbiaClearBreath.test.ts
// 密集句子在同一位置让位：手指清除与哈气只选一条路径，不能先擦开又哈出白色残字（上游 e8291cb）。
vi.mock('@/components/visualizer/nebbia/nebbiaLayout', () => ({
    layoutNebbiaSong: (lines: NebbiaSourceLine[]) => lines.map(line => line.chars.map(() => ({ x: 100, y: 100, s: 70, rot: 0 }))),
}));

const glyphs = { get: () => ({ strokes: [{ pts: [[0.2, 0.5], [0.8, 0.5]], cum: [0, 0.6], len: 0.6 }], total: 0.6 }) } as unknown as NebbiaGlyphCache;
const source = (t: number, next: number): NebbiaSourceLine => ({ t, end: t + 0.5, next, chars: [{ ch: '一', t, d: 0.5 }], words: [[0]] });
const scene = (next: number) => buildNebbiaScene([source(0, next), source(next, next + 4)], glyphs,
    { ...DEFAULT_NEBBIA_TUNING, appear: ['breath'], fade: ['fingers'], jitter: 0, warp: 0, credits: false }, { W: 360, H: 720, fontScale: 1 }, 'clear-breath');

describe('nebbia clearing and breath yield', () => {
    it('does not breathe again on the next sentence when fingers had time to clear the old one', () => {
        const [old, next] = scene(25);
        expect(old.breathAt).toBe(Infinity);
        expect(next.appearBreathAt).toBe(Infinity);
    });

    it('uses a single covering breath when a dense sentence leaves no time to wipe', () => {
        const [old] = scene(1.5);
        expect(Number.isFinite(old.breathAt)).toBe(true);
        expect(old.breathDur).toBeGreaterThanOrEqual(0.3);
        expect(yieldFactor(old, old.breathAt)).toBe(1);
        expect(yieldFactor(old, old.breathAt + old.breathDur)).toBe(0);
    });
});
