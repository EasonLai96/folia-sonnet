import { describe, expect, it } from 'vitest';
import { createFrameRateLimitedRaf, installGlobalVisualizerFrameRateLimiter, nextAllowedFrameTimestamp, parseVisualizerFrameRate, setGlobalVisualizerFrameRate, shouldProcessFrameAtRate } from '../../../src/utils/frameRateLimiter';

// test/unit/utils/frameRateLimiter.test.ts

describe('frameRateLimiter', () => {
    it('parses supported visualizer frame rates', () => {
        expect(parseVisualizerFrameRate(null)).toBe('off');
        expect(parseVisualizerFrameRate('off')).toBe('off');
        expect(parseVisualizerFrameRate('auto')).toBe('off');
        expect(parseVisualizerFrameRate('120')).toBe(120);
        expect(parseVisualizerFrameRate('90')).toBe(90);
        expect(parseVisualizerFrameRate('60')).toBe(60);
        expect(parseVisualizerFrameRate('30')).toBe(30);
        expect(parseVisualizerFrameRate('15')).toBe('off');
        expect(parseVisualizerFrameRate('24')).toBe('off');
    });

    it('skips frames until the next allowed timestamp arrives', () => {
        expect(shouldProcessFrameAtRate(1000, 0, 60)).toBe(true);
        // 60fps 首帧放行于 1000 → 下一帧最早 1016.67
        expect(shouldProcessFrameAtRate(1015, 1016.67, 60)).toBe(false);
        expect(shouldProcessFrameAtRate(1016, 1016.67, 60)).toBe(true);
    });

    // 120Hz 屏上限 90：按「上次放行的实际时刻 + 一个间隔」判会攒满两帧才放行，档位塌到 60。
    // 累积推进下一允许时刻才是四帧放行三帧的节奏。
    it('paces 90fps as three of four frames on a 120Hz display', () => {
        const frames = [1008.33, 1016.67, 1025, 1033.33, 1041.67, 1050, 1058.33];
        let nextAllowed = nextAllowedFrameTimestamp(1000, 0, 90);
        let allowed = 0;

        for (const time of frames) {
            if (!shouldProcessFrameAtRate(time, nextAllowed, 90)) continue;
            allowed += 1;
            nextAllowed = nextAllowedFrameTimestamp(time, nextAllowed, 90);
        }

        expect(allowed).toBeGreaterThanOrEqual(5);
    });

    it('re-anchors instead of catching up after a long stall', () => {
        // 掉帧/后台回来后 nextAllowed 早已过期：不能直接 += 一个间隔，否则会连续放行把欠的帧补回来。
        expect(nextAllowedFrameTimestamp(5000, 1000, 60)).toBe(5000 + 1000 / 60);
        expect(nextAllowedFrameTimestamp(1016, 1000, 60)).toBe(1000 + 1000 / 60);
    });

    it('always processes frames when disabled', () => {
        expect(shouldProcessFrameAtRate(1001, 1000, 'off')).toBe(true);
        expect(nextAllowedFrameTimestamp(1001, 1000, 'off')).toBe(0);
    });

    it('flushes all queued callbacks together on allowed frames', () => {
        const nativeCallbacks: FrameRequestCallback[] = [];
        const limiter = createFrameRateLimitedRaf(
            (callback) => {
                nativeCallbacks.push(callback);
                return nativeCallbacks.length;
            },
            () => undefined,
            60,
        );
        const processed: string[] = [];

        limiter.requestAnimationFrame(() => processed.push('a'));
        limiter.requestAnimationFrame(() => processed.push('b'));

        nativeCallbacks[0]?.(1000);
        expect(processed).toEqual(['a', 'b']);

        limiter.requestAnimationFrame(() => processed.push('c'));
        nativeCallbacks[1]?.(1015);
        expect(processed).toEqual(['a', 'b']);

        nativeCallbacks[2]?.(1016);
        expect(processed).toEqual(['a', 'b', 'c']);
    });

    it('continues flushing callbacks when one callback throws', () => {
        const originalConsoleError = console.error;
        const originalSetTimeout = globalThis.setTimeout;
        const nativeCallbacks: FrameRequestCallback[] = [];
        const reportedErrors: unknown[] = [];
        console.error = () => undefined;
        globalThis.setTimeout = ((callback: TimerHandler) => {
            try {
                if (typeof callback === 'function') {
                    callback();
                }
            } catch (error) {
                reportedErrors.push(error);
            }
            return 1 as unknown as ReturnType<typeof setTimeout>;
        }) as unknown as typeof setTimeout;

        try {
            const limiter = createFrameRateLimitedRaf(
                (callback) => {
                    nativeCallbacks.push(callback);
                    return nativeCallbacks.length;
                },
                () => undefined,
                60,
            );
            const error = new Error('boom');
            const processed: string[] = [];

            limiter.requestAnimationFrame(() => {
                throw error;
            });
            limiter.requestAnimationFrame(() => processed.push('after-error'));
            nativeCallbacks[0]?.(1000);

            expect(processed).toEqual(['after-error']);
            expect(reportedErrors).toEqual([error]);

            limiter.requestAnimationFrame(() => processed.push('next-frame'));
            nativeCallbacks[1]?.(1016);
            expect(processed).toEqual(['after-error', 'next-frame']);
        } finally {
            console.error = originalConsoleError;
            globalThis.setTimeout = originalSetTimeout;
        }
    });

    it('lets an earlier callback cancel a self-scheduling callback in the same frame', () => {
        const nativeCallbacks: FrameRequestCallback[] = [];
        const limiter = createFrameRateLimitedRaf(callback => {
            nativeCallbacks.push(callback);
            return nativeCallbacks.length;
        }, () => undefined);
        const processed: string[] = [];
        limiter.requestAnimationFrame(() => {
            processed.push('cancel');
            limiter.cancelAnimationFrame(rendererHandle);
        });
        const rendererHandle = limiter.requestAnimationFrame(() => {
            processed.push('renderer');
            limiter.requestAnimationFrame(() => processed.push('orphan'));
        });
        nativeCallbacks[0](1000);
        expect(processed).toEqual(['cancel']);
        expect(nativeCallbacks).toHaveLength(1);
    });

    it('cancels the native frame when the last queued callback is removed', () => {
        const cancelled: number[] = [];
        let requests = 0;
        const limiter = createFrameRateLimitedRaf(() => ++requests, handle => cancelled.push(handle));
        const first = limiter.requestAnimationFrame(() => undefined);
        const second = limiter.requestAnimationFrame(() => undefined);
        limiter.cancelAnimationFrame(first);
        expect(cancelled).toEqual([]);
        limiter.cancelAnimationFrame(second);
        expect(cancelled).toEqual([1]);
        limiter.requestAnimationFrame(() => undefined);
        expect(requests).toBe(2);
    });

    it('defers callbacks scheduled during a flush until the next frame', () => {
        const nativeCallbacks: FrameRequestCallback[] = [];
        const limiter = createFrameRateLimitedRaf(callback => { nativeCallbacks.push(callback); return nativeCallbacks.length; }, () => undefined);
        const processed: string[] = [];
        limiter.requestAnimationFrame(() => {
            processed.push('first');
            limiter.requestAnimationFrame(() => processed.push('next'));
        });
        nativeCallbacks[0](1000); expect(processed).toEqual(['first']);
        nativeCallbacks[1](1016); expect(processed).toEqual(['first', 'next']);
    });

    it('restores native requestAnimationFrame when disabled globally', () => {
        const previousWindow = (globalThis as { window?: Window; }).window;
        const originalRequestAnimationFrame = () => 1;
        const originalCancelAnimationFrame = () => undefined;
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                requestAnimationFrame: originalRequestAnimationFrame,
                cancelAnimationFrame: originalCancelAnimationFrame,
                localStorage: { getItem: () => null },
            },
        });

        try {
            installGlobalVisualizerFrameRateLimiter(60);
            expect(globalThis.window.requestAnimationFrame).not.toBe(originalRequestAnimationFrame);

            setGlobalVisualizerFrameRate('off');
            expect(globalThis.window.requestAnimationFrame).toBe(originalRequestAnimationFrame);
            expect(globalThis.window.cancelAnimationFrame).toBe(originalCancelAnimationFrame);
        } finally {
            Object.defineProperty(globalThis, 'window', {
                configurable: true,
                value: previousWindow,
            });
        }
    });
});
