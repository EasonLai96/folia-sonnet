import type { StatusMessage } from '../../types';
import type {
    PlaybackFailure,
    PlaybackFailureAction,
    PlaybackFailureContext,
    PlaybackFailureMessageKey,
    PlaybackFailurePolicy,
    PlaybackFailureReason,
} from '../../types/playbackFailure';

// src/services/playbackRecovery/playbackFailurePolicy.ts
// 播放失败的集中策略表：每个原因对应的文案、是否停播、是否倒计时跳歌、给哪些按钮、是否静默重试、是否冷却。
//
// 默认「出错就自动下一首」：倒计时期间不停播，倒计时自带「跳过 / 取消」；连跳次数用尽
// （usePlaybackQueueController 的 MAX_UNAVAILABLE_AUTO_SKIP_COUNT，现在是 2 —— 即跳两首，
// 第三首还错就停）或没有下一首可播时，才落到停播 + 一条普通消息。
// 少数原因是「整个平台都放不了」而不是「这一首放不了」（未登录、登录过期、服务没配置），
// 跳到下一首照样错，这类不倒计时，直接停。

const NO_RETRY: readonly number[] = [];

/** 出错后自动跳下一首的倒计时文案（与本地 / 转码那条旧路径同一条）。 */
const AUTO_SKIP_COUNTDOWN_KEY = 'status.playbackErrorPrompt';

// 停播、只给“跳过”：账号、权限、试听、地区这类重试也不会变好的原因。
// 默认倒计时跳歌；`autoSkipCountdown: false` 用于「整平台都放不了」的原因。
const stopWithSkip = (
    messageKey: PlaybackFailureMessageKey,
    options: { autoSkipCountdown?: boolean } = {},
): PlaybackFailurePolicy => {
    const autoSkipCountdown = options.autoSkipCountdown !== false;
    return {
        messageKey,
        ...(autoSkipCountdown ? { countdownKey: AUTO_SKIP_COUNTDOWN_KEY } : {}),
        stopPlayback: true,
        autoSkip: autoSkipCountdown ? 'countdown' : 'none',
        actions: ['skip'],
        autoRetryDelaysMs: NO_RETRY,
        cooldown: null,
        offerReplacement: false,
    };
};

// 停播、给“重试 / 跳过”：可能是暂时的，或证据不足的原因。
// 默认不自动跳：网络、超时、限流、服务不可用都是「整条链路」的事，跳到下一首照样放不了，
// 而且网一好，该放回去的是当前这首。只有证据指向「就是这一首放不出来」的原因
// （invalid-response / unknown，含解码失败与源不支持）才给倒计时。
const stopWithRetry = (
    messageKey: PlaybackFailureMessageKey,
    overrides: Partial<Pick<PlaybackFailurePolicy, 'autoRetryDelaysMs' | 'cooldown'>> & { autoSkipCountdown?: boolean } = {},
): PlaybackFailurePolicy => {
    const { autoSkipCountdown = false, ...rest } = overrides;
    return {
        messageKey,
        ...(autoSkipCountdown ? { countdownKey: AUTO_SKIP_COUNTDOWN_KEY } : {}),
        stopPlayback: true,
        autoSkip: autoSkipCountdown ? 'countdown' : 'none',
        actions: ['retry', 'skip'],
        autoRetryDelaysMs: NO_RETRY,
        cooldown: null,
        offerReplacement: false,
        ...rest,
    };
};

/** 每个原因的基础策略；用 Record 穷举，漏掉任何原因 tsc 都会报错。随 failure 变化的变体在 resolvePlaybackFailurePolicy 里解析。 */
export const PLAYBACK_FAILURE_POLICY: Readonly<Record<PlaybackFailureReason, PlaybackFailurePolicy>> = {
    // 未登录 / 登录过期：换哪首都一样放不了，跳就是不试了，直接停。
    'not-signed-in': stopWithSkip('status.songLoginRequired', { autoSkipCountdown: false }),
    'session-expired': stopWithSkip('status.loginExpired', { autoSkipCountdown: false }),
    'membership-required': stopWithSkip('status.songMembershipRequired'),
    'purchase-required': stopWithSkip('status.songPurchaseRequired'),
    'entitlement-required': stopWithSkip('status.songEntitlementRequired'),
    'preview-only': stopWithSkip('status.songPreviewOnly'),
    'region-restricted': stopWithSkip('status.songRegionRestricted'),
    // 倒计时期间不暂停；倒计时自带“跳过 / 取消”，次数用尽后只留一条消息。
    'taken-down': {
        messageKey: 'status.songUnavailable',
        countdownKey: 'status.songUnavailablePrompt',
        stopPlayback: false,
        autoSkip: 'countdown',
        actions: [],
        autoRetryDelaysMs: NO_RETRY,
        cooldown: null,
        offerReplacement: true,
    },
    network: stopWithRetry('status.songNetworkFailed', { autoRetryDelaysMs: [1000, 3000] }),
    timeout: stopWithRetry('status.songRequestTimedOut', { autoRetryDelaysMs: [2000] }),
    'service-unavailable': stopWithRetry('status.songServiceUnavailable', { cooldown: 'retry-after' }),
    'rate-limited': stopWithRetry('status.songRateLimitedNoWait', { cooldown: 'retry-after' }),
    // 响应不对 / 说不清为什么（含媒体元素解码失败、源不支持）：重试过一次还是不行，
    // 基本就是这一首的问题，交给倒计时跳下一首。
    'invalid-response': stopWithRetry('status.songTemporarilyUnavailable', { autoSkipCountdown: true }),
    unknown: stopWithRetry('status.songTemporarilyUnavailable', { autoSkipCountdown: true }),
};

/** 文案及其变体：限流带等待秒数、服务未配置、证据不足但登录可能有用。 */
export const getPlaybackFailureMessage = (
    failure: PlaybackFailure,
): { key: PlaybackFailureMessageKey; params?: { seconds: number } } => {
    /*
     * 登录相关的两条优先用带平台名的版本。
     *
     * 手机上一首歌可能来自任意一个平台，「登录已失效，请重新登录」不点名的话，用户
     * 只能挨个平台试。providerId 有就带上（{{provider}} 由展示层补成平台显示名）。
     */
    if (failure.providerId && failure.reason === 'session-expired') {
        return { key: 'status.providerLoginExpired' };
    }
    if (failure.providerId && failure.reason === 'not-signed-in') {
        return { key: 'status.songLoginRequiredForProvider' };
    }
    switch (failure.reason) {
        case 'rate-limited':
            if (typeof failure.retryAfterMs === 'number' && failure.retryAfterMs > 0) {
                return { key: 'status.songRateLimited', params: { seconds: Math.max(1, Math.ceil(failure.retryAfterMs / 1000)) } };
            }
            return { key: 'status.songRateLimitedNoWait' };
        case 'service-unavailable':
            return { key: failure.transient === false ? 'status.songServiceNotConfigured' : 'status.songServiceUnavailable' };
        case 'unknown':
            return { key: failure.hint ? 'status.songTemporarilyUnavailableSignInHint' : 'status.songTemporarilyUnavailable' };
        default:
            return { key: PLAYBACK_FAILURE_POLICY[failure.reason].messageKey };
    }
};

/**
 * 解析一次失败在给定上下文下的最终策略：先套变体（文案、未配置时去掉重试），再套上下文覆盖。
 * 'restore' 只显示一条消息，不倒计时也不给按钮；'mid-playback' 与 'play' 相同（停播时由 presenter 置 PAUSED）。
 */
export const resolvePlaybackFailurePolicy = (
    failure: PlaybackFailure,
    context: PlaybackFailureContext,
): PlaybackFailurePolicy => {
    const base = PLAYBACK_FAILURE_POLICY[failure.reason];
    const message = getPlaybackFailureMessage(failure);
    let policy: PlaybackFailurePolicy = {
        ...base,
        messageKey: message.key,
        ...(message.params ? { messageParams: message.params } : {}),
    };

    // 未配置 / 需要桌面版：重试不会变好，只留“跳过”；也不是这一首的问题，别去跳下一首。
    if (failure.reason === 'service-unavailable' && failure.transient === false) {
        policy = { ...policy, autoSkip: 'none', actions: ['skip'] };
        delete policy.countdownKey;
    }

    if (context === 'restore') {
        policy = { ...policy, autoSkip: 'none', actions: [] };
        delete policy.countdownKey;
    }

    return policy;
};

export const PLAYBACK_RETRYING_MESSAGE_KEY = 'status.songRetrying';

// 用对象字面量登记全部文案 key：漏掉 PlaybackFailureMessageKey 的任何成员 tsc 都会报错。
const MESSAGE_KEY_REGISTRY: Record<PlaybackFailureMessageKey, true> = {
    'status.songLoginRequired': true,
    'status.loginExpired': true,
    'status.songLoginRequiredForProvider': true,
    'status.providerLoginExpired': true,
    'status.songMembershipRequired': true,
    'status.songPurchaseRequired': true,
    'status.songEntitlementRequired': true,
    'status.songPreviewOnly': true,
    'status.songRegionRestricted': true,
    'status.songUnavailable': true,
    'status.songNetworkFailed': true,
    'status.songRequestTimedOut': true,
    'status.songServiceUnavailable': true,
    'status.songServiceNotConfigured': true,
    'status.songRateLimited': true,
    'status.songRateLimitedNoWait': true,
    'status.songTemporarilyUnavailable': true,
    'status.songTemporarilyUnavailableSignInHint': true,
};

/**
 * 只有这两条文案需要 {{provider}}。
 *
 * 平台名只对「登录」那两条有意义 —— 别的文案塞进去只是噪音（i18next 会静默忽略，
 * 但会让文案参数看起来莫名其妙，测试也会跟着乱）。
 */
const PROVIDER_LABEL_MESSAGE_KEYS: ReadonlySet<PlaybackFailureMessageKey> = new Set<PlaybackFailureMessageKey>([
    'status.songLoginRequiredForProvider',
    'status.providerLoginExpired',
]);

/** 需要平台名的文案才补上 {{provider}}；其余原样返回策略自己的参数。 */
export const withProviderLabel = (
    message: { key: PlaybackFailureMessageKey; params?: { seconds: number } },
    providerLabel: string | undefined,
): Record<string, unknown> | undefined => {
    if (!providerLabel || !PROVIDER_LABEL_MESSAGE_KEYS.has(message.key)) return message.params;
    return { provider: providerLabel, ...(message.params ?? {}) };
};

/** 全部 messageKey（含变体）、倒计时 key 和重试中提示；供文案覆盖测试使用。 */
export const PLAYBACK_FAILURE_MESSAGE_KEYS: readonly string[] = Array.from(new Set<string>([
    ...Object.keys(MESSAGE_KEY_REGISTRY),
    ...Object.values(PLAYBACK_FAILURE_POLICY).flatMap(policy => (policy.countdownKey ? [policy.countdownKey] : [])),
    PLAYBACK_RETRYING_MESSAGE_KEY,
]));

export const PLAYBACK_FAILURE_ACTION_LABEL_KEYS = ['ui.retry', 'status.skipUnavailableAction', 'status.cancel'] as const;

const ACTION_LABEL_KEY: Record<PlaybackFailureAction, string> = {
    retry: 'ui.retry',
    skip: 'status.skipUnavailableAction',
};

// 本模块发出的常驻失败消息。“重试 / 跳过”两个按钮占满了消息，没有单独的关闭按钮，
// transport 和 audio bridge 的 autoplay 在播放真正恢复时据此收起它；倒计时等其他常驻消息不在其中，不受影响。
const PLAYBACK_FAILURE_STATUSES = new WeakSet<StatusMessage>();

/** 这条消息是不是 buildPlaybackFailureStatus 发出的常驻失败消息。 */
export const isPlaybackFailureStatus = (message: StatusMessage | null | undefined): boolean => (
    Boolean(message && PLAYBACK_FAILURE_STATUSES.has(message))
);

/**
 * 把策略变成一条状态消息：先过滤掉没有 handler 的按钮；有按钮时第一个是主按钮，
 * 第二个是副按钮（没有就用“取消”关闭消息），消息常驻；没有按钮时是一条普通错误消息。
 */
export const buildPlaybackFailureStatus = (
    policy: PlaybackFailurePolicy,
    t: (key: string, options?: Record<string, unknown>) => string,
    handlers: { retry?: () => void; skip?: () => void; dismiss: () => void },
    /** 额外插值（目前只有 {{provider}}：平台显示名）。策略自己带的 params 优先。 */
    extraParams?: Record<string, unknown>,
): StatusMessage => {
    const params = { ...(extraParams ?? {}), ...(policy.messageParams ?? {}) };
    const text = Object.keys(params).length > 0 ? t(policy.messageKey, params) : t(policy.messageKey);
    const actions = policy.actions.filter(action => Boolean(handlers[action]));
    if (actions.length === 0) return { type: 'error', text };

    const [primary, secondary] = actions;
    const status: StatusMessage = {
        type: 'error',
        text,
        persistent: true,
        actionLabel: t(ACTION_LABEL_KEY[primary]),
        onAction: handlers[primary],
        cancelLabel: secondary ? t(ACTION_LABEL_KEY[secondary]) : t('status.cancel'),
        onCancel: secondary ? handlers[secondary] : handlers.dismiss,
    };
    PLAYBACK_FAILURE_STATUSES.add(status);
    return status;
};

/** loader 自动重试之间的等待；用 globalThis.setTimeout，Node 测试环境和浏览器都能用。 */
export const sleepForPlaybackRetry = (ms: number): Promise<void> => new Promise(resolve => {
    globalThis.setTimeout(resolve, ms);
});
