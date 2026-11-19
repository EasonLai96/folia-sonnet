import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as BeatsModuleNs from '../../../src/services/automix/nativeBeats';

// 使用真实 Capacitor 注册代理和排程，只替换门禁取值与原生传输端。
const { blockedReason } = vi.hoisted(() => ({ blockedReason: vi.fn<() => string | null>() }));
vi.mock('../../../src/services/aiMemoryGate', () => ({
    AI_MEMORY_GUARDED: 'ai-memory-guarded: ',
    localInferenceBlockedReason: blockedReason,
}));

type BeatsModule = typeof BeatsModuleNs;
const pluginName = 'FoliaAutomixModels';
const grid = { beats: [], fps: 50, frames: 50 };
const nativePromise = vi.fn<(plugin: string, method: string, options: unknown) => Promise<unknown>>();
const nativeCallback = vi.fn<(plugin: string, method: string, options: unknown, callback: unknown) => string>();
let beats: BeatsModule;

beforeAll(async () => {
    const bridge = {
        PluginHeaders: [{
            name: pluginName,
            methods: [
                { name: 'analyzeBeats', rtype: 'promise' },
                { name: 'analyzeBeatsFromUrl', rtype: 'promise' },
                { name: 'cancelAutomix', rtype: 'promise' },
                { name: 'getStatus', rtype: 'promise' },
                { name: 'addListener' },
                { name: 'removeListener' },
            ],
        }],
        nativePromise,
        nativeCallback,
    };
    vi.stubGlobal('Capacitor', bridge);
    vi.stubGlobal('window', { Capacitor: bridge });
    vi.stubGlobal('androidBridge', {});
    nativePromise.mockResolvedValue({ models: [] });
    beats = await import('../../../src/services/automix/nativeBeats');
});

afterAll(() => vi.unstubAllGlobals());
afterEach(() => vi.useRealTimers());

beforeEach(() => {
    blockedReason.mockReset().mockReturnValue(null);
    nativePromise.mockReset().mockResolvedValue(grid);
    nativeCallback.mockReset().mockReturnValue('progress-id');
});

describe('native beat dispatch through Capacitor', () => {
    it.each([
        { method: 'analyzeBeats', preflight: 1, run: () => beats.analyzeBeatsNative(new Float32Array(22050)) },
        { method: 'analyzeBeatsFromUrl', preflight: 2, run: () => beats.analyzeBeatsNativeFromUrl('/fixture') },
    ])('does not send $method when the gate closes after the final preflight', async ({ method, preflight, run }) => {
        const events: string[] = [];
        let blocked = false;
        let checks = 0;
        blockedReason.mockImplementation(() => {
            if (++checks === preflight) {
                events.push('preflight allowed');
                queueMicrotask(() => {
                    blocked = true;
                    events.push('gate closed');
                });
            }
            return blocked ? 'low-memory' : null;
        });
        nativePromise.mockImplementation(async (_plugin, dispatched) => {
            events.push(`sent ${dispatched}; allowed=${!blocked}`);
            return grid;
        });

        const outcome = await run().catch((error: unknown) => error);

        expect(events).toEqual(['preflight allowed', 'gate closed']);
        expect(outcome).toBeInstanceOf(beats.NativeBeatGateDeferred);
        expect(nativePromise).not.toHaveBeenCalled();
        if (method === 'analyzeBeatsFromUrl') {
            expect(nativeCallback.mock.calls.map(([plugin, event, options]) => [plugin, event, options])).toEqual([
                [pluginName, 'addListener', { eventName: 'beatAnalysisProgress' }],
                [pluginName, 'removeListener', { eventName: 'beatAnalysisProgress', callbackId: 'progress-id' }],
            ]);
        }
    });

    it('sends PCM and URL once each when the gate stays open', async () => {
        await expect(beats.analyzeBeatsNative(new Float32Array(22050))).resolves.toEqual(grid);
        await expect(beats.analyzeBeatsNativeFromUrl('/fixture')).resolves.toEqual(grid);
        expect(nativePromise.mock.calls).toEqual([
            [pluginName, 'analyzeBeats', { samples: 'A'.repeat(117600) }],
            [pluginName, 'analyzeBeatsFromUrl', { url: '/fixture' }],
        ]);
    });

    it('keeps cancellation on timeout after a URL analysis dispatch', async () => {
        vi.useFakeTimers();
        nativePromise.mockReturnValueOnce(new Promise(() => {}));
        const outcome = beats.analyzeBeatsNativeFromUrl('/fixture', 1000).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(1000);
        expect(await outcome).toEqual(new Error('原生节拍分析超过 1 秒没有结果'));
        expect(nativePromise.mock.calls).toEqual([
            [pluginName, 'analyzeBeatsFromUrl', { url: '/fixture' }],
            [pluginName, 'cancelAutomix', undefined],
        ]);
    });
});
