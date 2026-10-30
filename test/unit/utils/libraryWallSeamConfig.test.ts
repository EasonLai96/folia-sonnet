import { describe, expect, it } from 'vitest';
import { compressConfig, decompressConfig } from '@/utils/appearanceCodec';
import { migrateLibraryWallSeamConfig } from '@/utils/libraryWallSeamConfig';

// Issue #113：旧短码 / 长 JSON 的反向位在导入边界折成方向，新出口不再携带旧字段。
const short = (payload: Record<string, unknown>) => `folia-theme://${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
const shapes = [
    { name: 'short-key JSON', encode: (direction: unknown, reverse: unknown) => JSON.stringify({ lwsd: direction, lwdr: reverse }) },
    { name: 'legacy shortcode', encode: (direction: unknown, reverse: unknown) => short({ lwsd: direction, lwdr: reverse }) },
    { name: 'long-key JSON', encode: (direction: unknown, reverse: unknown) => JSON.stringify({ libraryWallSeamDirection: direction, libraryWallSeamDirectionReverse: reverse }) },
];

describe('legacy library wall seam config migration', () => {
    for (const shape of shapes) {
        describe(shape.name, () => {
            it.each([[true, 'auto-reverse'], [false, 'auto']] as const)('folds auto + reverse=%s into %s', (reverse, expected) => {
                expect(decompressConfig(shape.encode('auto', reverse))).toEqual({ libraryWallSeamDirection: expected });
            });

            it.each([[true, 'auto-reverse'], [false, 'auto']] as const)('accepts a legacy-only flag %s without rejecting the config', (reverse, expected) => {
                expect(decompressConfig(shape.encode(undefined, reverse))).toEqual({ libraryWallSeamDirection: expected });
            });

            it.each(['auto-reverse', 'vertical', 'horizontal'])('never flips explicit %s even when a stale reverse flag exists', direction => {
                for (const reverse of [true, false]) {
                    expect(decompressConfig(shape.encode(direction, reverse))).toEqual({ libraryWallSeamDirection: direction });
                }
            });

            it('leaves valid auto unchanged when no legacy flag was exported', () => {
                expect(decompressConfig(shape.encode('auto', undefined))).toEqual({ libraryWallSeamDirection: 'auto' });
            });
        });
    }

    it('does not mutate the input or resurrect the old field on another export', () => {
        const original = { libraryWallSeamDirection: 'auto', libraryWallSeamDirectionReverse: true, playerHeaderBlur: false };
        const migrated = migrateLibraryWallSeamConfig(original);
        expect(original).toEqual({ libraryWallSeamDirection: 'auto', libraryWallSeamDirectionReverse: true, playerHeaderBlur: false });
        expect(migrated).toEqual({ libraryWallSeamDirection: 'auto-reverse', playerHeaderBlur: false });
        expect(migrateLibraryWallSeamConfig(migrated)).toEqual(migrated);
        const encoded = compressConfig(migrated);
        const payload = JSON.parse(Buffer.from(encoded.slice('folia-theme://'.length), 'base64').toString('utf8'));
        expect(payload).toMatchObject({ lwsd: 'auto-reverse', phb: false });
        expect(payload).not.toHaveProperty('lwdr');
        expect(decompressConfig(encoded)).toEqual(migrated);
    });

    it('ignores legacy reverse fields supplied directly to the exporter', () => {
        const encoded = compressConfig({ libraryWallSeamDirection: 'auto-reverse', libraryWallSeamDirectionReverse: true });
        const payload = JSON.parse(Buffer.from(encoded.slice('folia-theme://'.length), 'base64').toString('utf8'));
        expect(payload).toEqual({ lwsd: 'auto-reverse' });
    });
});
