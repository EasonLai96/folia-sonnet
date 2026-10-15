import { createAiFetch } from './aiNativeFetch';
import { describeAiTarget, type AiCompletionTarget } from './aiCompletion';
import { isFoliaCloudCacheEnabled, resolveCloudApiUrl } from './foliaCloud';
import { md5 } from '../utils/md5';

// src/services/aiCloudCache.ts
// AI 云缓存：把「这段歌词已经有人生成过了」这件事存到服务器上。
//
// 缓存键是**歌词文件本身的 MD5**，不是歌名、不是播放源 —— 同一份歌词，
// 谁先生成谁上传，后面的人直接取答案，不再烧一次模型调用。
//
// 两条纪律：
//  1. **拉取不需要 Key。** 开关默认打开正是为了没填 Key 的人：他本来一个
//     主题都生成不出来，能命中别人的结果就是白赚。
//  2. **缓存永不阻塞功能。** 拉失败、推失败、返回的 JSON 不认识 —— 全部
//     静默退回「照常生成」，缓存只是加速器，不是依赖。

/** 提示词一改，缓存就换一批：老答案的格式未必还能用。 */
const CACHE_SCHEMA = 'v1';
const REQUEST_TIMEOUT_MS = 12_000;
/** 同一个键刚问过「没有」就别再问，省一次往返。 */
const MISS_TTL_MS = 5 * 60 * 1000;

/*
 * 只有一种。
 *
 * 主题与动画决策合成一次请求之后，服务端也只留一种条目：一条 stage =
 * 「这段歌词对应的主题 + 动画」。以前 theme / director 各存一条，同一段歌词交两遍，
 * 两条链路各拉自己那条 —— 既浪费空间，也没法一次往返同时喂饱两条链路。
 */
export type AiCloudCacheKind = 'stage';

/** `/api/ai-cache/<kind>/<md5>`。 */
export const resolveAiCloudCacheUrl = (kind: AiCloudCacheKind, key: string): string => (
    resolveCloudApiUrl(`ai-cache/${encodeURIComponent(kind)}/${encodeURIComponent(key)}`)
);

/**
 * 歌词文件的指纹。
 *
 * `policy` 用来把「同一份词、不同设置」隔开：导演的判断受屏蔽模式、用户提示、
 * 最近用过的样式影响，这些变了就该重新问一次，否则会拿到前一个设置的答案。
 */
export const fingerprintLyricSource = (
    kind: AiCloudCacheKind,
    lyricSource: string,
    policy = '',
): string => md5(`${CACHE_SCHEMA}\n${kind}\n${policy}\n${String(lyricSource ?? '')}`);

const missCache = new Map<string, number>();

const missKey = (kind: AiCloudCacheKind, key: string) => `${kind}:${key}`;

const rememberMiss = (kind: AiCloudCacheKind, key: string): void => {
    missCache.set(missKey(kind, key), Date.now());
    if (missCache.size > 200) {
        // Cheap eviction: the oldest misses are the least likely to be asked.
        const oldest = [...missCache.entries()].sort((left, right) => left[1] - right[1])[0];
        if (oldest) missCache.delete(oldest[0]);
    }
};

const wasRecentMiss = (kind: AiCloudCacheKind, key: string): boolean => {
    const at = missCache.get(missKey(kind, key));
    if (!at) return false;
    if (Date.now() - at > MISS_TTL_MS) {
        missCache.delete(missKey(kind, key));
        return false;
    }
    return true;
};

export type AiCloudCachePull =
    | { status: 'hit'; payload: unknown }
    | { status: 'miss' }
    | { status: 'unavailable' };

export interface AiCloudCachePushMeta {
    songTitle?: string;
    target?: AiCompletionTarget | null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const withTimeout = (): AbortSignal => {
    const controller = new AbortController();
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    }
    return controller.signal;
};

/** 拉一次。出错一律当「没命中」，调用方照常生成。 */
export const pullAiCloudCache = async (
    kind: AiCloudCacheKind,
    key: string,
): Promise<AiCloudCachePull> => {
    if (!isFoliaCloudCacheEnabled()) return { status: 'unavailable' };
    if (!/^[a-f0-9]{32}$/.test(key)) return { status: 'unavailable' };
    if (wasRecentMiss(kind, key)) return { status: 'miss' };

    try {
        const response = await createAiFetch()(resolveAiCloudCacheUrl(kind, key), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: withTimeout(),
        });
        if (!response.ok) return { status: 'miss' };
        const data = await response.json().catch(() => null) as { hit?: unknown; entry?: unknown } | null;
        const entry = data?.entry;
        if (data?.hit !== true || !isPlainObject(entry) || !('payload' in entry)) {
            rememberMiss(kind, key);
            return { status: 'miss' };
        }
        return { status: 'hit', payload: entry.payload };
    } catch {
        return { status: 'miss' };
    }
};

/** 推一次。失败就当没发生过，绝不打断已经生成好的结果。 */
export const pushAiCloudCache = async (
    kind: AiCloudCacheKind,
    key: string,
    payload: unknown,
    meta: AiCloudCachePushMeta = {},
): Promise<boolean> => {
    if (!isFoliaCloudCacheEnabled()) return false;
    if (!/^[a-f0-9]{32}$/.test(key)) return false;

    try {
        const response = await createAiFetch()(resolveAiCloudCacheUrl(kind, key), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                payload,
                songTitle: meta.songTitle ?? '',
                provider: meta.target?.provider ?? '',
                model: meta.target?.model ?? '',
            }),
            signal: withTimeout(),
        });
        return response.ok;
    } catch {
        return false;
    }
};

export type AiCloudCacheSource = 'cloud' | 'ai';

/**
 * 唯一该被功能代码调用的那个入口：先问缓存，没有再生成，生成完回传。
 *
 * `validate` 是调用方自己的闸门 —— 缓存里的东西**一律当不可信输入**处理，
 * 形状不对就跟没命中一样。少了这一步，服务端一条脏数据就能把播放页搞崩。
 */
export const withAiCloudCache = async <T>(options: {
    kind: AiCloudCacheKind;
    fingerprint: string;
    generate: () => Promise<T>;
    validate: (value: unknown) => T | null;
    songTitle?: string;
    /**
     * 别去问云端，直接生成 —— 「重新判断」就是要一个跟缓存里不一样的答案。
     *
     * 少了这一条，force 只是跳过了进程内缓存，云端那份照样命中，用户点
     * 「重新判断」永远是同一个结果。
     */
    skipPull?: boolean;
}): Promise<{ value: T; source: AiCloudCacheSource }> => {
    const { kind, fingerprint, generate, validate, songTitle, skipPull } = options;

    if (!skipPull && isFoliaCloudCacheEnabled()) {
        const pulled = await pullAiCloudCache(kind, fingerprint);
        const validated = pulled.status === 'hit' ? validate(pulled.payload) : null;
        if (validated !== null) return { value: validated, source: 'cloud' };
    }

    const value = await generate();
    void pushAiCloudCache(kind, fingerprint, value, { songTitle, target: describeAiTarget() });
    return { value, source: 'ai' };
};
