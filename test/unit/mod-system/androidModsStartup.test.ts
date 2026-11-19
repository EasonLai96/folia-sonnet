import { afterEach, expect, it, vi } from 'vitest';

// 执行真实 Web 入口，模拟 Android 按启动阶段注入原生桥，不启动 UI 或设备。
const { atBootstrap, setInferenceEnabled } = vi.hoisted(() => ({
    atBootstrap: vi.fn(() => window.electron?.mods),
    setInferenceEnabled: vi.fn(async ({ enabled }: { enabled: boolean }) => ({ enabled })),
}));

vi.mock('../../../src/services/automix/nativeBeats', () => ({ NativeBeats: { setInferenceEnabled } }));
vi.mock('../../../src/utils/backgroundRenderGate', () => ({ ensureBackgroundRenderGateInstalled: vi.fn() }));
vi.mock('../../../src/utils/frameRateLimiter', () => ({ installGlobalVisualizerFrameRateLimiter: vi.fn() }));
vi.mock('../../../src/utils/renderPixelRatio', () => ({ installRenderPixelRatioLimit: vi.fn() }));
vi.mock('../../../src/utils/consoleLogBuffer', () => ({ installConsoleLogCapture: vi.fn() }));
vi.mock('../../../src/services/debug/debugModule', () => ({ installDebugModule: vi.fn() }));
vi.mock('../../../src/services/debug/memorySamples', () => ({ installMemorySampleFeed: vi.fn() }));
vi.mock('../../../src/services/nativeAndroidBridge', () => ({ installNativeAndroidBridge: vi.fn() }));
vi.mock('../../../src/services/androidPhoneLayout', () => ({
    installPhoneOrientationPreference: vi.fn(), installDeviceProfilePreference: vi.fn(),
}));
vi.mock('../../../src/services/hdrProjection', () => ({ installHdrProjectionPreference: vi.fn() }));

const loadEntry = async (href: string, userAgent: string) => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv('DEV', false);
    vi.stubGlobal('window', { location: new URL(href) });
    vi.doMock('../../../src/bootstrap', () => { atBootstrap(); return {}; });
    atBootstrap.mockClear();
    vi.stubGlobal('navigator', { userAgent });
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => key === 'folia_ai_inference_disabled' ? 'false' : null,
        setItem: vi.fn(), removeItem: vi.fn(),
    });
    setInferenceEnabled.mockClear();
    await import('../../../src/index');
    await vi.dynamicImportSettled();
};

afterEach(async () => {
    const { resetAiMemoryGateForTest } = await import('../../../src/services/aiMemoryGate');
    resetAiMemoryGateForTest();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

it('installs the shim before bootstrap and recovers when the native bridge is injected later', async () => {
    const getDeviceMetrics = vi.fn(async () => ({ metrics: { lowMemory: 0, availMemKb: 1000, thresholdKb: 500 } }));
    const getNodeState = vi.fn(async () => ({ ready: true }));
    const listMods = vi.fn(async () => ({ ok: true, result: { directories: ['/android/mods'] } }));
    const addListener = vi.fn<(name: string, listener: (event: { payload: string }) => void) => { remove: () => void }>()
        .mockReturnValue({ remove: vi.fn() });

    await loadEntry('https://localhost/', 'Mozilla/5.0 (Linux; Android 15; Pixel 8; wv)');
    const { hasElectronBridge, isCapacitorAndroid } = await import('../../../src/platform/runtime');
    const gate = await import('../../../src/services/aiMemoryGate');
    const { installAndroidModsBridge } = await import('../../../src/mods/android/androidModsBridge');
    const mods = window.electron?.mods;
    expect(isCapacitorAndroid()).toBe(false);
    expect(atBootstrap).toHaveReturnedWith(expect.objectContaining({ getDeviceMetrics: expect.any(Function) }));
    expect(atBootstrap.mock.results[0]?.value).toBe(mods);
    expect(hasElectronBridge()).toBe(false);
    expect(gate.localInferenceBlockedReason()).toBe('native-not-ready');
    expect(setInferenceEnabled.mock.calls).toEqual([[{ enabled: false }]]);

    // Android 先注入插件 JS、后报告运行时就绪时，shim 也不能提前调用原生方法。
    Object.assign(window, { Capacitor: {
        Plugins: { FoliaMods: { getDeviceMetrics, getNodeState, listMods, addListener } },
        nativePromise: vi.fn(),
        nativeCallback: vi.fn(),
    } });
    const onLog = vi.fn();
    const logUnsubscribe = mods?.onModLog(onLog);
    const firstList = mods?.listMods();
    await vi.advanceTimersByTimeAsync(5_500);
    expect(getDeviceMetrics).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
    expect(getNodeState).not.toHaveBeenCalled();

    vi.stubGlobal('androidBridge', { postMessage: vi.fn() });
    expect(isCapacitorAndroid()).toBe(true);
    await vi.advanceTimersByTimeAsync(500);

    expect(getDeviceMetrics).toHaveBeenCalledOnce();
    expect(setInferenceEnabled.mock.calls).toEqual([[{ enabled: false }], [{ enabled: true }]]);
    expect(gate.localInferenceBlockedReason()).toBeNull();
    await expect(firstList).resolves.toMatchObject({ directories: ['/android/mods'] });
    expect(addListener).toHaveBeenCalledOnce();
    addListener.mock.calls[0]?.[1]({ payload: JSON.stringify({ type: 'log', modId: 'test', message: 'ready' }) });
    expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ modId: 'test', message: 'ready' }));
    logUnsubscribe?.();

    installAndroidModsBridge();
    expect(window.electron?.mods).toBe(mods);
    expect(hasElectronBridge()).toBe(false);
});

it('does not expose the shim to Android Chrome on the Web deployment', async () => {
    await loadEntry('https://example.invalid/', 'Mozilla/5.0 (Linux; Android 15; Pixel 8) Chrome/131.0.0.0');
    expect(atBootstrap).toHaveReturnedWith(undefined);
    expect(window.electron).toBeUndefined();
    expect(setInferenceEnabled).not.toHaveBeenCalled();
});
