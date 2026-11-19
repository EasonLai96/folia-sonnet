// src/services/aiMemoryGate.ts
// 「这台机器现在不该再跑 AI 推理」的闸门（issue #401）。
//
// 两条判据，任一成立就关闸：
//
//   ① 手机处于低内存：系统自己的 ActivityManager.MemoryInfo.lowMemory（它决定杀谁之前就会置这一位），
//      或可用内存掉到系统阈值以下。数据来自原生本来就在采的 DeviceMetrics.snapshot()
//      （复用 FoliaMods.getDeviceMetrics，不新开通道）。
//   ② 频繁 OOM / 被杀：连续几次启动都没能活过「稳定期」。安卓上 OOM 是被系统直接杀，进程里收不到
//      任何回调 —— 唯一可靠的证据就是「上次那回没走到标记点就没了」。所以这里在 localStorage 记一个
//      「这次启动到过稳定期」的标记：启动时读到没到过 → 上次崩了或被杀了，计数 +1；连续 N 次就锁闸。
//
// 内存压力只拦本地推理（原生 ONNX 的拍点与分轨）；在线补全只看设置总闸。
// 界面拿到的是 AI_MEMORY_GUARDED，提示用户稍后再试。
//
// 内存采样与原生开关确认只在安卓上介入。

import { ExceptionCode } from '@capacitor/core';
import { isAndroidAppShell, isCapacitorAndroid } from '../platform/runtime';
import { readAiInferenceDisabled, useAiInferenceSettingsStore } from '../stores/useAiInferenceSettingsStore';
import { getStoredString, removeStoredKey, setStoredString } from '../stores/storagePrimitives';

/** 闸门关着时抛出的前缀（调用方据此换成人话，别当普通失败报）。 */
export const AI_MEMORY_GUARDED = 'ai-memory-guarded: ';

// 三把键直接写在调用点上（不走变量）：dev/dedicatus 的键扫描按字面量认「这把键还在用」。
const LOW_MEMORY_FLAG_KEY = 'folia_ai_low_memory_gate';
const UNSTABLE_RUNS_KEY = 'folia_ai_unstable_runs';
const RUN_ALIVE_KEY = 'folia_ai_run_alive';

/** 连续几次「没走到稳定期就没了」就认定频繁 OOM。 */
const UNSTABLE_RUNS_LIMIT = 2;
/** 启动后多久算「这一回活下来了」。太短会把正常切后台也当成崩。 */
const STABLE_AFTER_MS = 60_000;
/** 采样间隔：低内存是个缓变量，30 秒足够，也不至于在内存紧张时自己添负担。 */
const POLL_INTERVAL_MS = 30_000;
/** Node 宿主冷启时指标可能未就绪；只在首样本前加三次短重采。 */
const FIRST_SAMPLE_RETRY_MS = [500, 1_500, 4_000] as const;
/** 关闭失败独立重试，退避至采样频率；不用等指标恢复。 */
const FIRST_NATIVE_CLOSE_RETRY_MS = 1_000;

type GateState = {
    /** 系统报低内存 / 可用内存低于阈值。 */
    lowMemory: boolean;
    /** 连续「没活到稳定期」的次数。 */
    unstableRuns: number;
    /** 最近一次采样拿到的可用内存（KB），没采到是 null。 */
    availMemKb: number | null;
    /** 最近一次报低内存的时间。 */
    lastLowMemoryAt: number | null;
};

const state: GateState = {
    lowMemory: false,
    unstableRuns: 0,
    availMemKb: null,
    lastLowMemoryAt: null,
};

const listeners = new Set<() => void>();
let installed = false;
let stopInstallation: (() => void) | undefined;
let installation = 0;
let sampleSequence = 0;
let appliedSample = 0;
let hasMemorySample = false;
let nativeSyncPending = false;
let nativeSyncRunning = false;
let appliedNativeEnabled: boolean | undefined;
let lastLocalAvailability = false;
let nativeSwitchUnsupported = false;
let retryNativeOpenOnPoll = false;
let firstSampleRetryTimer: ReturnType<typeof setTimeout> | undefined;
let firstSampleRetries = 0;
let nativeCloseRetryTimer: ReturnType<typeof setTimeout> | undefined;
let nativeCloseRetryMs = FIRST_NATIVE_CLOSE_RETRY_MS;

/*
 * 闸门自己的记账。
 *
 * 键名一律以字面量出现在下面的 storage().getItem / setItem 调用里：dev/dedicatus 的 D507 扫描
 * 按「localStorage / storage() 上的读写 + 字面量键」认「这把键还在用」，走一层封装它会当成
 * 已废弃的孤儿键。storage() 自己吞掉「存储不可用」这件事（隐私模式、被裁的 WebView）。
 */
/*
 * 闸门自己的记账。
 *
 * 读写直接调 storagePrimitives 并把**常量名**传进去：dev/dedicatus 的 D507 扫描按「这些函数 +
 * 本文件里解析得出的键」认「这把键还在用」，中间再包一层就认不出来了。
 * storagePrimitives 自己吞掉「存储不可用」这件事（隐私模式、被裁的 WebView）。
 */

const notify = () => listeners.forEach((listener) => {
    try {
        listener();
    } catch {
        /* 一个坏订阅者不该挡住别人 */
    }
});

// 算实际可用性的边沿：ACK 和当前政策都成立才唤醒等待者。
const refreshLocalAvailability = (stateChanged = false) => {
    const allowed = isLocalInferenceAllowed();
    const opening = allowed && !lastLocalAvailability;
    lastLocalAvailability = allowed;
    if (opening || stateChanged) notify();
};

const setLowMemory = (low: boolean, availMemKb: number | null) => {
    const changed = state.lowMemory !== low || state.availMemKb !== availMemKb;
    state.lowMemory = low;
    state.availMemKb = availMemKb;
    if (low) state.lastLowMemoryAt = Date.now();
    if (!changed) {
        refreshLocalAvailability();
        return;
    }
    // 低内存状态也落盘：进程被杀死后重开时，界面至少知道「上次是内存紧的时候没的」。
    setStoredString(LOW_MEMORY_FLAG_KEY, low ? '1' : '0');
    refreshLocalAvailability(true);
};

const localPolicyBlockedReason = (): 'disabled-in-settings' | 'low-memory' | 'recent-oom' | null => {
    if (readAiInferenceDisabled()) return 'disabled-in-settings';
    if (state.lowMemory) return 'low-memory';
    if (state.unstableRuns >= UNSTABLE_RUNS_LIMIT) return 'recent-oom';
    return null;
};

const wantsNativeInference = () => hasMemorySample && localPolicyBlockedReason() === null;

// Capacitor 代理即使没有方法也返回函数；早于 PluginHeaders 注册时同样可能抛 UNIMPLEMENTED。
// 只用 Android 注入的实时方法表确认旧包不支持，不依据代理函数或异常文案推断。
const isNativeSwitchUnsupported = (error: unknown): boolean => {
    if (typeof error !== 'object' || error === null || !('code' in error)
        || error.code !== ExceptionCode.Unimplemented || !isCapacitorAndroid()) return false;
    const bridge = (window as typeof window & { Capacitor?: {
        nativePromise?: unknown;
        PluginHeaders?: readonly { name: string; methods: readonly { name: string }[] }[];
    } }).Capacitor;
    const headers = bridge?.PluginHeaders;
    if (typeof bridge?.nativePromise !== 'function' || !headers) return false;
    const plugin = headers.find(({ name }) => name === 'FoliaAutomixModels');
    return !plugin?.methods.some(({ name }) => name === 'setInferenceEnabled');
};

const clearNativeCloseRetry = () => {
    clearTimeout(nativeCloseRetryTimer);
    nativeCloseRetryTimer = undefined;
    nativeCloseRetryMs = FIRST_NATIVE_CLOSE_RETRY_MS;
};

/**
 * 把「本地推理能不能跑」推给原生，让 ONNX 在根源上就起不来。
 *
 * 原生侧（FoliaAutomixModelsPlugin.inferenceEnabled）默认 false：关着时 9 个推理方法入口直接
 * 拒绝，而且**不加载模型**；这里改成 false 时还会让原生把已加载的 OrtSession 与权重放掉。
 * 所以「禁掉之后内存真的还回去」，而不是只是不再发起新推理。
 *
 * 确认旧包不支持时不再重试，也不会开放 Web 端推理。
 */
const syncNativeInferenceSwitch = async (): Promise<void> => {
    if (!installed || !isAndroidAppShell() || nativeSwitchUnsupported) return;
    // 原生写入串行；写入期间只记「有变化」，下一趟重读最新判定，不回放旧值。
    nativeSyncPending = true;
    if (nativeSyncRunning) return;
    nativeSyncRunning = true;
    try {
        while (nativeSyncPending && !nativeSwitchUnsupported) {
            nativeSyncPending = false;
            const currentInstallation = installation;
            let enabled = wantsNativeInference();
            try {
                const { NativeBeats } = await import('./automix/nativeBeats');
                if (currentInstallation !== installation) continue;
                enabled = wantsNativeInference();
                if (enabled) clearNativeCloseRetry();
                if (appliedNativeEnabled === enabled || nativeCloseRetryTimer !== undefined) continue;
                if (typeof NativeBeats.setInferenceEnabled !== 'function') continue;
                // 一旦开始写，旧回执就不能再证明原生当前允许推理。
                retryNativeOpenOnPoll = false;
                appliedNativeEnabled = undefined;
                refreshLocalAvailability();
                const result = await NativeBeats.setInferenceEnabled({ enabled });
                if (currentInstallation !== installation) continue;
                if (result.enabled !== enabled) throw new Error('原生推理开关未确认请求状态');
                appliedNativeEnabled = enabled;
                clearNativeCloseRetry();
                // A memory sample alone does not open the gate: wake waiting consumers on the native reply.
                refreshLocalAvailability();
            } catch (error) {
                if (currentInstallation !== installation) continue;
                if (isNativeSwitchUnsupported(error)) {
                    nativeSwitchUnsupported = true;
                    nativeSyncPending = false;
                    clearNativeCloseRetry();
                    continue;
                }
                console.warn('[AiMemoryGate] 同步原生推理开关失败', error);
                // 关闭独立退避；开启失败只在正常轮询或政策变化时按最新判定重试。
                retryNativeOpenOnPoll = enabled;
                if (!enabled && !wantsNativeInference() && nativeCloseRetryTimer === undefined) {
                    nativeCloseRetryTimer = setTimeout(() => {
                        nativeCloseRetryTimer = undefined;
                        void syncNativeInferenceSwitch();
                    }, nativeCloseRetryMs);
                    nativeCloseRetryMs = Math.min(nativeCloseRetryMs * 2, POLL_INTERVAL_MS);
                }
            }
        }
    } finally {
        nativeSyncRunning = false;
    }
};

const scheduleFirstSampleRetry = () => {
    const delay = FIRST_SAMPLE_RETRY_MS.at(firstSampleRetries);
    if (hasMemorySample || firstSampleRetryTimer !== undefined || delay === undefined) return;
    firstSampleRetries += 1;
    firstSampleRetryTimer = setTimeout(() => {
        firstSampleRetryTimer = undefined;
        void sample();
    }, delay);
};

const readMetricNumber = (value: unknown): number => (
    typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN
);

/**
 * 读一次原生指标并更新闸门。
 *
 * 走 `window.electron.mods.getDeviceMetrics`（安卓上是 androidModsBridge 装的那份 shim，
 * 桌面端是 preload 的同一组合约）：原生本来就在按固定间隔采 CPU / 内存 / 温度，这里只是把
 * 内存那几项读出来，不新开通道、也不多一次采样线程。
 */
const sample = async (): Promise<void> => {
    const currentInstallation = installation;
    const sequence = ++sampleSequence;
    // IPC 可能永不结算，短重采的预算和时钟不能依赖这次响应。
    scheduleFirstSampleRetry();
    try {
        const mods = (window as typeof window & {
            electron?: { mods?: { getDeviceMetrics?: () => Promise<{ metrics?: Record<string, unknown> | null }> } };
        }).electron?.mods;
        if (typeof mods?.getDeviceMetrics !== 'function') return;
        const reply = await mods.getDeviceMetrics();
        const metrics = reply?.metrics ?? null;
        if (!metrics || currentInstallation !== installation || sequence <= appliedSample) return;
        const lowMemory = readMetricNumber(metrics.lowMemory);
        const availMem = readMetricNumber(metrics.availMemKb);
        const threshold = readMetricNumber(metrics.thresholdKb);
        const availMemKb = Number.isFinite(availMem) && availMem >= 0 ? availMem : null;
        const hasThresholdReading = availMemKb !== null && Number.isFinite(threshold) && threshold > 0;
        // 启动时没有内存数据就保持原生默认拒绝，等到有效采样再决定。
        if (lowMemory !== 0 && lowMemory !== 1 && !hasThresholdReading) return;
        // 系统没置 lowMemory、但可用内存已经贴着阈值时按低内存处理：那一档离被判定 low 只差一步。
        const nearThreshold = hasThresholdReading && availMemKb < threshold * 1.5;
        appliedSample = sequence;
        hasMemorySample = true;
        clearTimeout(firstSampleRetryTimer);
        firstSampleRetryTimer = undefined;
        setLowMemory(lowMemory === 1 || nearThreshold, availMemKb);
        if (currentInstallation === installation) void syncNativeInferenceSwitch();
    } catch (error) {
        // 采不到不是「内存够」：保持上一次的结论，宁可保守。
        if (currentInstallation === installation && sequence > appliedSample) console.warn('[AiMemoryGate] 读设备内存失败', error);
    }
};

/**
 * 启动时调用一次：读上一回的稳定性标记、算连续崩溃次数、起轮询。
 *
 * 幂等 —— 重复调用只装一次。
 */
export const installAiMemoryGate = (): void => {
    if (installed) return;
    installed = true;

    // 上一回有没有活到稳定期？没有就记一次。
    const lastRunAlive = getStoredString(RUN_ALIVE_KEY, '') === '1';
    if (!isAndroidAppShell()) {
        state.unstableRuns = 0;
    } else if (lastRunAlive) {
        state.unstableRuns = 0;
        removeStoredKey(UNSTABLE_RUNS_KEY);
    } else {
        state.unstableRuns = Math.min(Number(getStoredString(UNSTABLE_RUNS_KEY, '') || 0) + 1, 99);
        setStoredString(UNSTABLE_RUNS_KEY, String(state.unstableRuns));
    }
    setStoredString(RUN_ALIVE_KEY, '0');

    // 走到稳定期就把这一轮记成「活下来了」。
    const stableTimer = setTimeout(() => {
        setStoredString(RUN_ALIVE_KEY, '1');
        if (state.unstableRuns !== 0) {
            state.unstableRuns = 0;
            removeStoredKey(UNSTABLE_RUNS_KEY);
            refreshLocalAvailability(true);
            void syncNativeInferenceSwitch();
        }
    }, STABLE_AFTER_MS);

    stopInstallation = () => { clearTimeout(stableTimer); };
    if (!isAndroidAppShell()) return;

    const unsubscribeSettings = useAiInferenceSettingsStore.subscribe((next, previous) => {
        if (next.aiInferenceDisabled === previous.aiInferenceDisabled) return;
        refreshLocalAvailability();
        void syncNativeInferenceSwitch();
    });
    void syncNativeInferenceSwitch();
    void sample();
    const pollTimer = setInterval(() => {
        void sample();
        // 首次有效采样仍是开启的前提；后续取不到指标时，沿用最近一次有效判定。
        if (retryNativeOpenOnPoll && wantsNativeInference()) void syncNativeInferenceSwitch();
    }, POLL_INTERVAL_MS);
    // 页面回到前台时补采一次：后台期间系统的内存状况可能已经变了。
    const page = typeof document === 'undefined' ? undefined : document;
    const onVisibilityChange = () => {
        if (page?.visibilityState === 'visible') void sample();
    };
    page?.addEventListener('visibilitychange', onVisibilityChange);
    stopInstallation = () => {
        clearTimeout(stableTimer);
        clearInterval(pollTimer);
        clearTimeout(firstSampleRetryTimer);
        firstSampleRetryTimer = undefined;
        clearNativeCloseRetry();
        unsubscribeSettings();
        page?.removeEventListener('visibilitychange', onVisibilityChange);
    };
};

/*
 * 两道闸，管的东西不一样 —— 别合并成一个。
 *
 *   · 本地推理（on-device）：整曲 PCM + 几十 MB 权重 + onnxruntime，峰值内存是整机的大头。
 *     它同时受「总闸」和「内存水位」管：系统已经在赶内存时再起推理，等于自己送上门被杀。
 *   · 在线补全（AI 主题 / 导演 / 云缓存）：只是一次网络请求，本地只解析一段文本，**不占本地内存**。
 *     它只受总闸管 —— 内存紧的时候禁它没有任何收益，只会让用户以为功能坏了。
 */

/** 内存压力：系统报低内存，或最近连续几次启动都没活到稳定期（频繁 OOM / 被杀）。 */
export const isUnderMemoryPressure = (): boolean => (
    state.lowMemory || state.unstableRuns >= UNSTABLE_RUNS_LIMIT
);

/** 本地推理被挡住的原因；可以跑返回 null。 */
export const localInferenceBlockedReason = (): ReturnType<typeof localPolicyBlockedReason> | 'native-not-ready' => {
    const policyReason = localPolicyBlockedReason();
    if (policyReason !== null) return policyReason;
    if (isAndroidAppShell() && (!installed || !hasMemorySample || appliedNativeEnabled !== true)) return 'native-not-ready';
    return null;
};

/** 在线补全被挡住的原因；可以发返回 null（只看总闸，不看内存）。 */
export const onlineInferenceBlockedReason = (): 'disabled-in-settings' | null => (
    readAiInferenceDisabled() ? 'disabled-in-settings' : null
);

/** 本地推理能不能跑：总闸关着，且不处在内存压力下。 */
export const isLocalInferenceAllowed = (): boolean => localInferenceBlockedReason() === null;

/** 在线补全能不能发：只看总闸。 */
export const isOnlineInferenceAllowed = (): boolean => onlineInferenceBlockedReason() === null;

const guardError = (reason: string) => Object.assign(
    new Error(`${AI_MEMORY_GUARDED}${reason}`),
    { code: 'ai-memory-guarded' },
);

/** 本地推理被挡住就抛（原生模型入口用）。 */
export const assertLocalInferenceAllowed = (): void => {
    const reason = localInferenceBlockedReason();
    if (reason !== null) throw guardError(reason);
};

/** 在线补全被挡住就抛（requestAiCompletion 用）。 */
export const assertOnlineInferenceAllowed = (): void => {
    const reason = onlineInferenceBlockedReason();
    if (reason !== null) throw guardError(reason);
};

/** 一次性读快照（界面显示 / 诊断用）。 */
export const readAiMemoryGateState = (): Readonly<GateState> => ({ ...state });

export const subscribeAiMemoryGate = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/** 测试用：把闸门恢复到刚装好的样子。 */
export const resetAiMemoryGateForTest = (): void => {
    stopInstallation?.();
    stopInstallation = undefined;
    installed = false;
    installation += 1;
    sampleSequence = 0;
    appliedSample = 0;
    hasMemorySample = false;
    firstSampleRetries = 0;
    // 已发出的 bridge 调用无法撤回；保留运行中的写入锁，重装后也不会并行写。
    nativeSyncPending = false;
    appliedNativeEnabled = undefined;
    lastLocalAvailability = false;
    nativeSwitchUnsupported = false;
    retryNativeOpenOnPoll = false;
    state.lowMemory = false;
    state.unstableRuns = 0;
    state.availMemKb = null;
    state.lastLowMemoryAt = null;
    listeners.clear();
};
