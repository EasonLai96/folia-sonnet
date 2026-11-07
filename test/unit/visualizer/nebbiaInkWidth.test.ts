import { describe, expect, it } from 'vitest';
import { nebbiaInkWidth } from '../../../src/components/visualizer/nebbia/nebbiaInkWidth';

// Regression: the previous fixed 8px floor made mobile stroke-width controls ineffective.
describe('nebbia small glyph ink width', () => {
    it.each([20, 24, 32, 48, 64])('respects the stroke slider at %ipx', size => {
        expect(nebbiaInkWidth(0.04, size, 12)).toBeLessThan(nebbiaInkWidth(0.09, size, 12));
        expect(nebbiaInkWidth(0.09, size, 12)).toBeLessThan(nebbiaInkWidth(0.16, size, 12));
        expect(nebbiaInkWidth(0.04, size, 12)).toBeLessThanOrEqual(0.04);
    });
    it('retains complexity thinning', () => {
        expect(nebbiaInkWidth(0.09, 32, 30)).toBeCloseTo(0.09 * 0.55);
        expect(nebbiaInkWidth(0.09, 32, 4)).toBeCloseTo(0.09);
    });
    it('keeps the existing look on large desktop glyphs', () => {
        expect(nebbiaInkWidth(0.09, 240, 4)).toBeCloseTo(Math.max(0.09, 8 / 240));
    });
    it('does not divide by zero', () => {
        expect(Number.isFinite(nebbiaInkWidth(0.09, 0, 0))).toBe(true);
    });
});
