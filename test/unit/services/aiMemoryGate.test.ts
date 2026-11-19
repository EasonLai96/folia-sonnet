import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/services/aiMemoryGate.test.ts
// AI 推理闸门（issue #401）分成两道，判据不同：
//   · 本地推理（拍点、分轨等 on-device 模型）：总闸 + 内存水位 + 连续被杀次数，任一拦住就不跑。
//   · 在线补全（AI 主题 / 导演 / 云缓存）：只看总闸 —— 它只是一次网络请求，不占本地内存。

const storage = new Map<string, string>();
const setInferenceEnabled = vi.fn<(options: { enabled: boolean }) => Promise<{ enabled?: boolean }>>();
let cleanupGate: (() => void) | undefined;

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
};

const mockMemory = () => {
    const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const metrics = (lowMemory: boolean) => ({ metrics: { lowMemory: Number(lowMemory), availMemKb: 1000, thresholdKb: 500 } });
    const getDeviceMetrics = vi.fn<() => Promise<{ metrics: Record<string, unknown> | null }>>()
        .mockResolvedValue(metrics(false));
    vi.stubGlobal('document', page);
    Object.assign(window, { electron: { mods: { getDeviceMetrics } } });
    const resume = () => { page.dispatchEvent(new Event('visibilitychange')); };
    return { page, resume, metrics, getDeviceMetrics };
};

const flushSync = async () => {
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
};

const stubStorage = () => {
    const localStorageStub = {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, String(value)); },
        removeItem: (key: string) => { storage.delete(key); },
    };
    vi.stubGlobal('window', { localStorage: localStorageStub });
    vi.stubGlobal('localStorage', localStorageStub);
};

const loadGate = async (android = false, keepNativeWrappers = false) => {
    vi.resetModules();
    stubStorage();
    // 闸门的「连续被杀」与内存采样只在安卓上介入；用例里按需要把它当安卓。
    vi.doMock('../../../src/platform/runtime', () => ({
        isCapacitorAndroid: () => android,
        isAndroidAppShell: () => android,
    }));
    setInferenceEnabled.mockReset().mockImplementation(async ({ enabled }) => ({ enabled }));
    if (keepNativeWrappers) vi.doUnmock('../../../src/services/automix/nativeBeats');
    else vi.doMock('../../../src/services/automix/nativeBeats', () => ({ NativeBeats: { setInferenceEnabled } }));
    const gate = await import('../../../src/services/aiMemoryGate');
    cleanupGate = gate.resetAiMemoryGateForTest;
    return gate;
};

const setInferenceDisabled = async (disabled: boolean) => {
    const { useAiInferenceSettingsStore } = await import('../../../src/stores/useAiInferenceSettingsStore');
    useAiInferenceSettingsStore.getState().setAiInferenceDisabled(disabled);
};

afterEach(() => {
    cleanupGate?.();
    cleanupGate = undefined;
    storage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('native inference switch', () => {
    it('starts denied, then follows the setting and sampled low-memory recovery', async () => {
        const gate = await loadGate(true);
        const memory = mockMemory();
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        await flushSync();
        expect(setInferenceEnabled.mock.calls).toEqual([[{ enabled: false }]]);

        await setInferenceDisabled(false);
        await flushSync();
        expect(setInferenceEnabled).toHaveBeenLastCalledWith({ enabled: true });

        memory.getDeviceMetrics.mockResolvedValue(memory.metrics(true));
        await vi.advanceTimersByTimeAsync(30_000);
        await flushSync();
        expect(gate.localInferenceBlockedReason()).toBe('low-memory');
        expect(gate.isOnlineInferenceAllowed()).toBe(true);
        expect(setInferenceEnabled).toHaveBeenLastCalledWith({ enabled: false });

        memory.getDeviceMetrics.mockResolvedValue(memory.metrics(false));
        memory.resume();
        await flushSync();
        expect(setInferenceEnabled).toHaveBeenLastCalledWith({ enabled: true });

        await setInferenceDisabled(true);
        await flushSync();
        expect(setInferenceEnabled.mock.calls.map(([{ enabled }]) => enabled)).toEqual([false, true, false, true, false]);
    });

    it('does not open on startup before a successful memory sample', async () => {
        const gate = await loadGate(true);
        const memory = mockMemory();
        const pendingMemory = deferred<ReturnType<typeof memory.metrics>>();
        memory.getDeviceMetrics.mockReturnValueOnce(pendingMemory.promise);
        await setInferenceDisabled(false);
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        await flushSync();
        expect(setInferenceEnabled.mock.calls).toEqual([[{ enabled: false }]]);

        pendingMemory.resolve(memory.metrics(true));
        await flushSync();
        expect(setInferenceEnabled.mock.calls).toEqual([[{ enabled: false }]]);

        memory.resume();
        await flushSync();
        expect(setInferenceEnabled.mock.calls).toEqual([[{ enabled: false }], [{ enabled: true }]]);
    });

    it('notifies subscribers of availability only after a successful native enable reply', async () => {
        const gate = await loadGate(true);
        const memory = mockMemory();
        const enabling = deferred<{ enabled?: boolean }>();
        memory.getDeviceMetrics.mockResolvedValueOnce({ metrics: null });
        await setInferenceDisabled(false);
        setInferenceEnabled.mockImplementation(({ enabled }) => enabled ? enabling.promise : Promise.resolve({ enabled }));
        const ready = vi.fn();
        const unsubscribe = gate.subscribeAiMemoryGate(() => {
            if (gate.isLocalInferenceAllowed()) ready();
        });
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        await flushSync();
        await vi.advanceTimersByTimeAsync(500);
        expect(gate.localInferenceBlockedReason()).toBe('native-not-ready');
        expect(setInferenceEnabled).toHaveBeenLastCalledWith({ enabled: true });
        expect(ready).not.toHaveBeenCalled();
        enabling.resolve({ enabled: true });
        await flushSync();
        expect(ready).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it('notifies on a setting reopen after a delayed ACK was applied while disabled', async () => {
        const gate = await loadGate(true);
        const memory = mockMemory();
        const enabling = deferred<{ enabled?: boolean }>();
        const { useAiInferenceSettingsStore } = await import('../../../src/stores/useAiInferenceSettingsStore');
        const setDisabled = useAiInferenceSettingsStore.getState().setAiInferenceDisabled;
        setInferenceEnabled.mockResolvedValueOnce({ enabled: false }).mockReturnValueOnce(enabling.promise);
        const ready = vi.fn();
        gate.subscribeAiMemoryGate(() => { if (gate.isLocalInferenceAllowed()) ready(); });
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        await flushSync();
        setDisabled(false);
        await flushSync();
        expect(setInferenceEnabled).toHaveBeenLastCalledWith({ enabled: true });
        setDisabled(true);
        enabling.resolve({ enabled: true });
        // The ACK continuation runs first; the next serialized native write still awaits import.
        await Promise.resolve();
        expect(gate.isLocalInferenceAllowed()).toBe(false);
        expect(ready).not.toHaveBeenCalled();
        setDisabled(false);
        await flushSync();
        expect(gate.isLocalInferenceAllowed()).toBe(true);
        expect(ready).toHaveBeenCalledTimes(1);
        expect(setInferenceEnabled.mock.calls.map(([{ enabled }]) => enabled)).toEqual([false, true]);
        expect(memory.getDeviceMetrics).toHaveBeenCalledTimes(1);
    });

    it('retries null, rejected and malformed first samples promptly', async () => {
        const gate = await loadGate(true);
        const memory = mockMemory();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        memory.getDeviceMetrics.mockResolvedValueOnce({ metrics: null })
            .mockRejectedValueOnce(new Error('metrics bridge not ready'))
            .mockResolvedValueOnce({ metrics: { lowMemory: '', availMemKb: '', thresholdKb: 500 } });
        await setInferenceDisabled(false);
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        try {
            await flushSync();
            expect(setInferenceEnabled.mock.calls).toEqual([[{ enabled: false }]]);
            await vi.advanceTimersByTimeAsync(8_000);
            await flushSync();
            expect(memory.getDeviceMetrics).toHaveBeenCalledTimes(4);
            expect(setInferenceEnabled.mock.calls).toEqual([[{ enabled: false }], [{ enabled: true }]]);
            expect(gate.isLocalInferenceAllowed()).toBe(true);
        } finally {
            warn.mockRestore();
        }
    });

    it('retries before a hung first sample settles and ignores its late reply', async () => {
        const gate = await loadGate(true);
        const memory = mockMemory();
        const hung = deferred<ReturnType<typeof memory.metrics>>();
        memory.getDeviceMetrics.mockReturnValueOnce(hung.promise).mockResolvedValue(memory.metrics(true));
        await setInferenceDisabled(false);
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        await flushSync();
        expect(gate.localInferenceBlockedReason()).toBe('native-not-ready');

        await vi.advanceTimersByTimeAsync(500);
        expect(memory.getDeviceMetrics).toHaveBeenCalledTimes(2);
        expect(gate.localInferenceBlockedReason()).toBe('low-memory');
        hung.resolve(memory.metrics(false));
        await flushSync();
        expect(gate.localInferenceBlockedReason()).toBe('low-memory');
        expect(setInferenceEnabled.mock.calls).toEqual([[{ enabled: false }]]);
    });

    it('bounds first-sample retries even if every read hangs and cancels them on reset', async () => {
        const gate = await loadGate(true);
        const memory = mockMemory();
        const hung = deferred<ReturnType<typeof memory.metrics>>();
        memory.getDeviceMetrics.mockReturnValue(hung.promise);
        await setInferenceDisabled(false);
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        await flushSync();
        await vi.advanceTimersByTimeAsync(8_000);
        expect(memory.getDeviceMetrics).toHaveBeenCalledTimes(4);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(memory.getDeviceMetrics).toHaveBeenCalledTimes(4);
        gate.resetAiMemoryGateForTest();
        gate.installAiMemoryGate();
        await flushSync();
        gate.resetAiMemoryGateForTest();
        await vi.advanceTimersByTimeAsync(8_000);
        expect(memory.getDeviceMetrics).toHaveBeenCalledTimes(5);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('denies Android local calls before installation, sampling or an enabled acknowledgement', async () => {
        const gate = await loadGate(true);
        const memory = mockMemory();
        const first = deferred<ReturnType<typeof memory.metrics>>();
        const enabling = deferred<{ enabled?: boolean }>();
        memory.getDeviceMetrics.mockReturnValueOnce(first.promise);
        setInferenceEnabled.mockResolvedValueOnce({ enabled: false }).mockReturnValueOnce(enabling.promise);
        await setInferenceDisabled(false);
        expect(gate.isLocalInferenceAllowed()).toBe(false);
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        await flushSync();
        expect(() => gate.assertLocalInferenceAllowed()).toThrowError(/^ai-memory-guarded/);
        expect(gate.isOnlineInferenceAllowed()).toBe(true);

        first.resolve(memory.metrics(false));
        await flushSync();
        expect(setInferenceEnabled).toHaveBeenLastCalledWith({ enabled: true });
        expect(gate.isLocalInferenceAllowed()).toBe(false);
        expect(gate.isOnlineInferenceAllowed()).toBe(true);
        enabling.resolve({ enabled: true });
        await flushSync();
        expect(gate.isLocalInferenceAllowed()).toBe(true);
        gate.resetAiMemoryGateForTest();
        expect(gate.isLocalInferenceAllowed()).toBe(false);
        expect(gate.isOnlineInferenceAllowed()).toBe(true);
    });

    it('does not treat a mismatched acknowledgement as open or urgently retry enabling', async () => {
        const gate = await loadGate(true);
        mockMemory();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setInferenceEnabled.mockResolvedValueOnce({ enabled: false }).mockResolvedValueOnce({ enabled: false });
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        try {
            await flushSync();
            await setInferenceDisabled(false);
            await flushSync();
            expect(gate.isLocalInferenceAllowed()).toBe(false);
            await vi.advanceTimersByTimeAsync(8_000);
            expect(setInferenceEnabled.mock.calls.map(([{ enabled }]) => enabled)).toEqual([false, true]);
            expect(gate.isLocalInferenceAllowed()).toBe(false);
        } finally {
            warn.mockRestore();
        }
    });

    it.each(['empty', 'hung'] as const)('recovers a failed opening when later metrics are %s', async (kind) => {
        const gate = await loadGate(true);
        const memory = mockMemory();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const enabling = deferred<{ enabled?: boolean }>();
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        try {
            await flushSync();
            setInferenceEnabled.mockRejectedValueOnce(new Error('open bridge failed')).mockReturnValueOnce(enabling.promise);
            await setInferenceDisabled(false);
            await flushSync();
            expect(gate.localInferenceBlockedReason()).toBe('native-not-ready');
            expect(gate.isOnlineInferenceAllowed()).toBe(true);
            if (kind === 'empty') memory.getDeviceMetrics.mockResolvedValue({ metrics: null });
            else memory.getDeviceMetrics.mockReturnValue(deferred<ReturnType<typeof memory.metrics>>().promise);

            await vi.advanceTimersByTimeAsync(8_000);
            expect(setInferenceEnabled.mock.calls.map(([{ enabled }]) => enabled)).toEqual([false, true]);
            await vi.advanceTimersByTimeAsync(23_000);
            await flushSync();
            expect(setInferenceEnabled.mock.calls.map(([{ enabled }]) => enabled)).toEqual([false, true, true]);
            expect(gate.localInferenceBlockedReason()).toBe('native-not-ready');
            enabling.resolve({ enabled: true });
            await flushSync();
            expect(gate.isLocalInferenceAllowed()).toBe(true);
        } finally {
            warn.mockRestore();
        }
    });

    it('stops writes to an old APK only after the live Android headers confirm the method is absent', async () => {
        const gate = await loadGate(true);
        const memory = mockMemory();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const unsupported = Object.assign(new Error('Capacitor proxy method is not implemented'), { code: 'UNIMPLEMENTED' });
        setInferenceEnabled.mockRejectedValue(unsupported);
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        try {
            await flushSync();
            expect(setInferenceEnabled).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1_000);
            expect(setInferenceEnabled).toHaveBeenCalledTimes(2);

            Object.assign(window, { Capacitor: {
                nativePromise: vi.fn(),
                PluginHeaders: [{ name: 'FoliaAutomixModels', methods: [{ name: 'getStatus' }] }],
            } });
            await vi.advanceTimersByTimeAsync(2_000);
            expect(setInferenceEnabled).toHaveBeenCalledTimes(3);
            expect(warn).toHaveBeenCalledTimes(2);
            await setInferenceDisabled(false);
            await vi.advanceTimersByTimeAsync(120_000);
            memory.resume();
            await flushSync();
            expect(setInferenceEnabled).toHaveBeenCalledTimes(3);
            expect(warn).toHaveBeenCalledTimes(2);
            expect(gate.localInferenceBlockedReason()).toBe('native-not-ready');
            expect(gate.isOnlineInferenceAllowed()).toBe(true);
        } finally {
            warn.mockRestore();
        }
    });

    it('keeps retrying a transient UNIMPLEMENTED when Android advertises the switch method', async () => {
        const gate = await loadGate(true);
        mockMemory();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const unsupported = Object.assign(new Error('proxy registered before the plugin header'), { code: 'UNIMPLEMENTED' });
        Object.assign(window, { Capacitor: {
            nativePromise: vi.fn(),
            PluginHeaders: [{ name: 'FoliaAutomixModels', methods: [{ name: 'setInferenceEnabled' }] }],
        } });
        setInferenceEnabled.mockRejectedValueOnce(unsupported);
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        try {
            await flushSync();
            expect(gate.isLocalInferenceAllowed()).toBe(false);
            await vi.advanceTimersByTimeAsync(1_000);
            expect(setInferenceEnabled.mock.calls).toEqual([[{ enabled: false }], [{ enabled: false }]]);
            await setInferenceDisabled(false);
            await flushSync();
            expect(setInferenceEnabled).toHaveBeenLastCalledWith({ enabled: true });
            expect(gate.isLocalInferenceAllowed()).toBe(true);
        } finally {
            warn.mockRestore();
        }
    });

    it('retries a failed close without waiting for another metric sample', async () => {
        const gate = await loadGate(true);
        const memory = mockMemory();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        try {
            await flushSync();
            await setInferenceDisabled(false);
            await flushSync();
            expect(gate.isLocalInferenceAllowed()).toBe(true);
            memory.getDeviceMetrics.mockResolvedValue({ metrics: null });
            setInferenceEnabled.mockRejectedValueOnce(new Error('close bridge failed'));

            await setInferenceDisabled(true);
            expect(gate.isLocalInferenceAllowed()).toBe(false);
            await flushSync();
            expect(setInferenceEnabled.mock.calls.map(([{ enabled }]) => enabled)).toEqual([false, true, false]);
            await vi.advanceTimersByTimeAsync(0);
            expect(setInferenceEnabled).toHaveBeenCalledTimes(3);
            await vi.advanceTimersByTimeAsync(8_000);
            expect(memory.getDeviceMetrics).toHaveBeenCalledTimes(1);
            expect(setInferenceEnabled.mock.calls.map(([{ enabled }]) => enabled)).toEqual([false, true, false, false]);
        } finally {
            warn.mockRestore();
        }
    });

    it('backs off repeated close failures and cancels the retry on reset', async () => {
        const gate = await loadGate(true);
        mockMemory();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        try {
            await flushSync();
            await setInferenceDisabled(false);
            await flushSync();
            setInferenceEnabled.mockRejectedValue(new Error('close bridge unavailable'));
            await setInferenceDisabled(true);
            await flushSync();
            await vi.advanceTimersByTimeAsync(1_000);
            expect(setInferenceEnabled).toHaveBeenCalledTimes(4);
            await vi.advanceTimersByTimeAsync(1_999);
            expect(setInferenceEnabled).toHaveBeenCalledTimes(4);
            await vi.advanceTimersByTimeAsync(1);
            expect(setInferenceEnabled).toHaveBeenCalledTimes(5);
            gate.resetAiMemoryGateForTest();
            await vi.advanceTimersByTimeAsync(60_000);
            expect(setInferenceEnabled).toHaveBeenCalledTimes(5);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            warn.mockRestore();
        }
    });

    it('does not let an old enabling reply open a reinstalled gate', async () => {
        const gate = await loadGate(true);
        const memory = mockMemory();
        const oldEnable = deferred<{ enabled?: boolean }>();
        setInferenceEnabled.mockResolvedValueOnce({ enabled: false }).mockReturnValueOnce(oldEnable.promise);
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        await flushSync();
        await setInferenceDisabled(false);
        await flushSync();
        expect(setInferenceEnabled).toHaveBeenLastCalledWith({ enabled: true });

        gate.resetAiMemoryGateForTest();
        storage.set('folia_ai_run_alive', '1');
        memory.getDeviceMetrics.mockResolvedValue({ metrics: null });
        gate.installAiMemoryGate();
        await flushSync();
        expect(setInferenceEnabled).toHaveBeenCalledTimes(2);
        oldEnable.resolve({ enabled: true });
        await flushSync();
        expect(setInferenceEnabled.mock.calls.map(([{ enabled }]) => enabled)).toEqual([false, true, false]);
        expect(gate.isLocalInferenceAllowed()).toBe(false);
    });

    it('blocks guarded native analysis IPCs but leaves cancellation callable', async () => {
        const gate = await loadGate(true, true);
        const stemIpc = vi.fn<() => Promise<unknown>>().mockResolvedValue({});
        const beatIpc = vi.fn<() => Promise<unknown>>().mockResolvedValue({});
        const cancelAutomix = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
        vi.doMock('@capacitor/core', () => ({
            registerPlugin: () => ({
                setInferenceEnabled, analyzeDrumBandsFromUrl: stemIpc, analyzeBeats: beatIpc, cancelAutomix,
                getStatus: async () => ({ models: [] }),
            }),
        }));
        try {
            const { analyzeBeatsNative } = await import('../../../src/services/automix/nativeBeats');
            const { analyzeDrumBandsNativeFromUrl, cancelNativeSeparation } = await import('../../../src/services/automix/nativeModels');
            await setInferenceDisabled(false);
            await expect(analyzeBeatsNative(new Float32Array(22050))).rejects.toThrow();
            await expect(analyzeDrumBandsNativeFromUrl('/fixture')).resolves.toBeNull();
            expect(beatIpc).not.toHaveBeenCalled();
            expect(stemIpc).not.toHaveBeenCalled();
            await cancelNativeSeparation();
            expect(cancelAutomix).toHaveBeenCalledTimes(1);
            expect(gate.isOnlineInferenceAllowed()).toBe(true);
        } finally {
            vi.doUnmock('@capacitor/core');
        }
    });

    it('does not overwrite a newer low-memory sample with a slow older one', async () => {
        const gate = await loadGate(true);
        const memory = mockMemory();
        const oldMemory = deferred<ReturnType<typeof memory.metrics>>();
        memory.getDeviceMetrics.mockReturnValueOnce(oldMemory.promise).mockResolvedValue(memory.metrics(true));
        await setInferenceDisabled(false);
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        memory.resume();
        await flushSync();
        oldMemory.resolve(memory.metrics(false));
        await flushSync();
        expect(gate.localInferenceBlockedReason()).toBe('low-memory');
        expect(setInferenceEnabled.mock.calls).toEqual([[{ enabled: false }]]);
    });

    it('serializes bridge writes and merges changes into the latest decision', async () => {
        const gate = await loadGate(true);
        const memory = mockMemory();
        const enabling = deferred<{ enabled?: boolean }>();
        setInferenceEnabled.mockResolvedValueOnce({ enabled: false }).mockReturnValueOnce(enabling.promise);
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        await flushSync();
        await setInferenceDisabled(false);
        await flushSync();
        expect(setInferenceEnabled.mock.calls.map(([{ enabled }]) => enabled)).toEqual([false, true]);

        await setInferenceDisabled(true);
        await setInferenceDisabled(false);
        memory.getDeviceMetrics.mockResolvedValue(memory.metrics(true));
        memory.resume();
        await flushSync();
        await vi.advanceTimersByTimeAsync(120_000);
        await flushSync();
        expect(setInferenceEnabled).toHaveBeenCalledTimes(2);
        expect(gate.isLocalInferenceAllowed()).toBe(false);

        enabling.resolve({ enabled: true });
        await flushSync();
        expect(setInferenceEnabled.mock.calls.map(([{ enabled }]) => enabled)).toEqual([false, true, false]);
    });

    it('keeps native inference denied until recent OOM pressure clears', async () => {
        const gate = await loadGate(true);
        mockMemory();
        storage.set('folia_ai_unstable_runs', '1');
        await setInferenceDisabled(false);
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        await flushSync();
        expect(setInferenceEnabled.mock.calls).toEqual([[{ enabled: false }]]);
        await vi.advanceTimersByTimeAsync(60_000);
        await flushSync();
        expect(setInferenceEnabled.mock.calls).toEqual([[{ enabled: false }], [{ enabled: true }]]);
    });

    it('cleans up listeners and ignores pending samples from a reset installation', async () => {
        const gate = await loadGate(true);
        const memory = mockMemory();
        const pendingMemory = deferred<ReturnType<typeof memory.metrics>>();
        const removeListener = vi.spyOn(memory.page, 'removeEventListener');
        const { useAiInferenceSettingsStore } = await import('../../../src/stores/useAiInferenceSettingsStore');
        const subscribe = useAiInferenceSettingsStore.subscribe;
        const unsubscribe = vi.fn<() => void>();
        vi.spyOn(useAiInferenceSettingsStore, 'subscribe').mockImplementation((listener) => {
            unsubscribe.mockImplementation(subscribe(listener));
            return unsubscribe;
        });
        memory.getDeviceMetrics.mockReturnValueOnce(pendingMemory.promise);
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        gate.installAiMemoryGate();
        await flushSync();
        gate.resetAiMemoryGateForTest();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
        expect(vi.getTimerCount()).toBe(0);
        await setInferenceDisabled(false);
        memory.resume();
        await flushSync();
        expect(memory.getDeviceMetrics).toHaveBeenCalledTimes(1);
        expect(setInferenceEnabled.mock.calls).toEqual([[{ enabled: false }]]);

        storage.set('folia_ai_run_alive', '1');
        gate.installAiMemoryGate();
        await flushSync();
        pendingMemory.resolve(memory.metrics(true));
        await flushSync();
        expect(gate.isLocalInferenceAllowed()).toBe(true);
        expect(setInferenceEnabled).toHaveBeenLastCalledWith({ enabled: true });
        expect(setInferenceEnabled.mock.calls.filter(([{ enabled }]) => enabled)).toHaveLength(1);
    });
});

describe('AI inference gate', () => {
    it('blocks both kinds by default, because the setting ships enabled', async () => {
        const gate = await loadGate();
        expect(gate.localInferenceBlockedReason()).toBe('disabled-in-settings');
        expect(gate.onlineInferenceBlockedReason()).toBe('disabled-in-settings');
        expect(gate.isLocalInferenceAllowed()).toBe(false);
        expect(gate.isOnlineInferenceAllowed()).toBe(false);
    });

    it('lets both run once the setting is turned off', async () => {
        const gate = await loadGate();
        await setInferenceDisabled(false);
        expect(gate.localInferenceBlockedReason()).toBeNull();
        expect(gate.onlineInferenceBlockedReason()).toBeNull();
        expect(() => gate.assertLocalInferenceAllowed()).not.toThrow();
        expect(() => gate.assertOnlineInferenceAllowed()).not.toThrow();
    });

    it('throws a recognisable code when blocked', async () => {
        const gate = await loadGate();
        await setInferenceDisabled(true);
        expect(() => gate.assertOnlineInferenceAllowed()).toThrowError(/^ai-memory-guarded/);
        try {
            gate.assertLocalInferenceAllowed();
        } catch (error) {
            expect((error as { code?: string }).code).toBe('ai-memory-guarded');
            expect((error as Error).message).toBe('ai-memory-guarded: disabled-in-settings');
        }
    });

    it('keeps online completion alive under memory pressure, and stops local inference', async () => {
        const gate = await loadGate(true);
        await setInferenceDisabled(false);
        // 连续两次没活到稳定期 → 内存压力成立。
        storage.set('folia_ai_run_alive', '0');
        storage.set('folia_ai_unstable_runs', '1');
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        expect(gate.isUnderMemoryPressure()).toBe(true);
        // 在线补全不受内存压力影响（它不占本地内存）。
        expect(gate.onlineInferenceBlockedReason()).toBeNull();
        expect(() => gate.assertOnlineInferenceAllowed()).not.toThrow();
        // 本地推理被拦住，并说明原因。
        expect(gate.localInferenceBlockedReason()).toBe('recent-oom');
        expect(() => gate.assertLocalInferenceAllowed()).toThrowError(/recent-oom/);
    });

    it('counts a launch that never reached the stable point as an unstable run', async () => {
        const gate = await loadGate(true);
        storage.set('folia_ai_run_alive', '0');
        vi.useFakeTimers();
        gate.installAiMemoryGate();
        expect(gate.readAiMemoryGateState().unstableRuns).toBe(1);
    });
});
