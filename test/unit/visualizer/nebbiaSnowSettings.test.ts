import { describe, expect, it } from 'vitest';
import nebbiaTuning, { normalizeNebbiaTuning } from '@/components/visualizer/nebbia/tuning';
import { DEFAULT_NEBBIA_TUNING } from '@/components/visualizer/nebbia/types';

// test/unit/visualizer/nebbiaSnowSettings.test.ts
// 融雪沿用原 nebbia_tuning 存档与通用外观包：旧配置补默认、已有玻璃不跟窗外切换、雪量归一化后可完整往返。

describe('nebbia snow settings compatibility', () => {
    it('adds snow defaults without changing old saved appearance values', () => {
        const read = normalizeNebbiaTuning({ behind: 'aquarium', mist: 0.45, hold: 2, layouts: ['ribbon'], appear: ['write'], fade: ['fingers'] });
        expect(read).toMatchObject({ behind: 'aquarium', glass: 'dew', mist: 0.45, hold: 2, layouts: ['ribbon'], appear: ['write'], fade: ['fingers'], snow: 1, snowSize: 1, snowMelt: 1 });
        expect(nebbiaTuning.storage?.key).toBe('nebbia_tuning');
    });

    it('keeps each chosen glass while cycling the window independently', () => {
        for (const glass of ['rain', 'dew', 'snow'] as const) {
            const held = normalizeNebbiaTuning({ glass });
            for (const behind of ['aquarium', 'backdrop', 'night'] as const) {
                const next = nebbiaTuning.storage!.merge(held, { behind });
                expect(next.glass).toBe(glass);
                expect(next.behind).toBe(behind);
            }
        }
    });

    it('clamps imported snow settings and preserves them through a JSON round trip', () => {
        const read = normalizeNebbiaTuning({ glass: 'snow', snow: 99, snowSize: 0, snowMelt: -3 });
        expect(read).toMatchObject({ glass: 'snow', snow: 3, snowSize: 0.5, snowMelt: 0.25 });
        expect(normalizeNebbiaTuning(JSON.parse(JSON.stringify(read)))).toEqual(read);
        expect(normalizeNebbiaTuning({ glass: 'unknown', snow: NaN, snowSize: '2', snowMelt: Infinity })).toEqual(DEFAULT_NEBBIA_TUNING);
    });
});
