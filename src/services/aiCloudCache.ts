import { createAiFetch, fetchAiCacheViaNative } from './aiNativeFetch';
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
/**
 * 合规的候选最多同时拉几条。
 *
 * 服务端一次最多给 12 个候选，全并发既没必要也不礼貌；取前几条已经够覆盖「第一条
 * 拉不动」这种常见情况。
 */
const MAX_CONCURRENT_ENTRY_FETCHES = 4;

/*
 * 只有一种。
 *
 * 主题与动画决策合成一次请求之后，服务端也只留一种条目：一条 stage =
 * 「这段歌词对应的主题 + 动画」。以前 theme / director 各存一条，同一段歌词交两遍，
 * 两条链路各拉自己那条 —— 既浪费空间，也没法一次往返同时喂饱两条链路。
 */
/**
 * `theme` = AI 主题（按歌算键，见 services/aiThemeCloud.ts）；
 * `stage` = 舞台决策（按歌词 + policy 算键）。
 *
 * 两种键混在一个 kind 里会互相盖：主题那一路推上去的条目里没有决策，
 * 正好把别人推的完整条目抹成半截。
 */
export type AiCloudCacheKind = 'stage' | 'theme';

/** `/api/ai-cache/<kind>/<md5>`。 */
export const resolveAiCloudCacheUrl = (kind: AiCloudCacheKind, key: string): string => (
    resolveCloudApiUrl(`ai-cache/${encodeURIComponent(kind)}/${encodeURIComponent(key)}`)
);

/** 精确键没命中时的兜底：按歌名要一批候选。 */
const resolveAiCloudResolveUrl = (): string => resolveCloudApiUrl('ai-cache/resolve');

/** 「云端现在有哪些歌」—— 首页「AI 主题」那一屏的歌名清单。 */
const resolveAiCloudSongsUrl = (): string => resolveCloudApiUrl('ai-cache/songs');

/**
 * 歌名清单里的一行（按歌名去重：同一首歌的几个歌词版本合起来算一首）。
 *
 * `platform` 是推上去那次记下的平台名，只当作「去哪儿搜」的**建议** —— 客户端
 * 用的是自己当前登着的那个平台，不是它（别人推的时候用的平台你未必登录了）。
 */
export type AiCloudCacheSongEntry = {
    songTitle: string;
    platform: string;
    key: string;
    updatedAt: string;
    hits: number;
    /** 这个歌名下存了几个歌词版本。 */
    versions: number;
};

export type AiCloudCacheSongPage = {
    /** 云端一共有多少首（去重后）—— 客户端拿它先把屏幕铺满。 */
    total: number;
    limit: number;
    offset: number;
    songs: AiCloudCacheSongEntry[];
};

/**
 * 拉一段歌名。失败一律返回空页 —— 缓存的纪律是永不阻塞功能，
 * 这一屏只是「看看云端有什么」，拉不到就当没有。
 */
export const listAiCloudCacheSongs = async (
    { limit = 60, offset = 0, query = '' }: { limit?: number; offset?: number; query?: string } = {},
): Promise<AiCloudCacheSongPage> => {
    const empty: AiCloudCacheSongPage = { total: 0, limit, offset, songs: [] };
    if (!isFoliaCloudCacheEnabled()) return empty;
    const search = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
    });
    // 搜索框里那个「AI 主题」来源：按歌名在云端筛。转义交给 URLSearchParams。
    const trimmedQuery = String(query ?? '').trim();
    if (trimmedQuery) search.set('q', trimmedQuery);
    try {
        const response = await createAiFetch()(`${resolveAiCloudSongsUrl()}?${search.toString()}`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: withTimeout(),
        });
        if (!response.ok) return empty;
        const data = await response.json().catch(() => null) as {
            ok?: unknown; total?: unknown; limit?: unknown; offset?: unknown; songs?: unknown;
        } | null;
        const list = Array.isArray(data?.songs) ? data?.songs : [];
        const songs: AiCloudCacheSongEntry[] = [];
        list.forEach((entry: unknown) => {
            if (!isPlainObject(entry)) return;
            const songTitle = String(entry.songTitle ?? '').trim().slice(0, 200);
            if (!songTitle) return;
            songs.push({
                songTitle,
                platform: String(entry.platform ?? '').trim().slice(0, 64),
                key: String(entry.key ?? '').trim().toLowerCase(),
                updatedAt: String(entry.updatedAt ?? ''),
                hits: Number(entry.hits ?? 0) || 0,
                versions: Number(entry.versions ?? 1) || 1,
            });
        });
        return {
            total: Number(data?.total ?? songs.length) || 0,
            limit: Number(data?.limit ?? limit) || limit,
            offset: Number(data?.offset ?? offset) || offset,
            songs,
        };
    } catch {
        return empty;
    }
};

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

/**
 * 刚推上去的那一键，本地别再当成「没有」。
 *
 * push 成功说明云端这个键**现在一定有了**，可 missCache 还记着「5 分钟前问过一次
 * 没有」。于是切走再切回来（或队列播完从头再来一轮）时 pull 会被这条 miss 直接挡掉：
 * 不发 GET、直接走去生成 —— 白烧一次模型，而「已从云端拉取缓存」这句提示也永远
 * 说不出来，明明缓存就是自己刚推上去的。
 */
const forgetMiss = (kind: AiCloudCacheKind, key: string): void => {
    missCache.delete(missKey(kind, key));
};

export type AiCloudCachePull =
    | {
        status: 'hit';
        payload: unknown;
        /**
         * exact = 精确键命中；
         * words = 键没对上，靠歌名捞到一条**内容合规**的（证据词都在你手上这段歌词里）；
         * forced = 一条合规的都没有，从兜底里挑的（证据只到一半，见
         * pickBestEffortCandidates）—— **未经证实**，所以它不参与回填。
         */
        matched: 'exact' | 'words' | 'forced';
        /** words 命中时，答案原本存在哪个键上 —— 回填到自己这个键要用它。 */
        sourceKey?: string;
    }
    | { status: 'miss' }
    | { status: 'unavailable' };

/** 按歌名搜到的候选：只有高亮词，没有 payload —— 判定的活在本机做。 */
interface ResolveCandidate {
    key: string;
    words: string[];
}

/**
 * 候选合不合规：**它标的高亮词，在你手上这段歌词里全都找得到**。
 *
 * 高亮词是模型照着歌词挑的 —— 一条照着别的歌做的答案，挑不出这首的词。所以这比
 * 「哈希必须一模一样」宽松得多（同一首歌换个版本的 LRC 就换一个哈希），又不会把
 * 另一首歌的答案错当成这首的。
 *
 * 比的时候压掉空白与大小写：LRC 里多一个空格不该判成「这不是同一个词」。
 */
const flattenForMatch = (value: string): string => (
    String(value ?? '').replace(/\s+/g, '').toLowerCase()
);

/**
 * 一个词要能当证据，至少得这么长。
 *
 * **单字不算证据**：「留」在几乎每一首中文歌里都能撞上，它说明不了这条答案是照着哪首
 * 歌词做的；「留住」才算一句有点内容的凭据。英文同理（单字母、单字都不算）。
 */
const MIN_EVIDENCE_WORD_LENGTH = 2;

/**
 * 不构成证据的词：代词、助词、连词、介词、疑问词、程度副词 —— **任何一首歌里都有**的那些。
 *
 * 它们出现在歌词里说明不了任何事情。用户报的例子最典型：一个候选的高亮词是
 * `留住 / 我 / 什么 / 把 / 你`，而手上这首的歌词里「留住」和「把」根本不存在，
 * 光靠「我」「什么」「你」这三个就把另一首近亲的答案顶成了这首的主题
 * （覆盖率算出来 3/5，看着还挺像那么回事）。
 *
 * 只收到「显然没有区分度」这一层为止 —— 开始 / 结束 / 快乐 这类实词**不**进这张表：
 * 它到底是内容还是套话机器分不清，宁可放过也不误伤。表里全是压平后（去空白、转小写）
 * 的形式。
 */
const NON_EVIDENCE_WORDS = new Set([
    // 代词与指称
    '我', '我们', '咱', '咱们', '你', '你们', '他', '他们', '她', '她们', '它', '它们',
    '自己', '大家', '这', '这个', '这些', '那', '那个', '那些', '谁', '什么', '怎么',
    '怎样', '怎么样', '这么', '那么', '多少', '哪里', '哪儿', '这里', '那里',
    // 助词 / 语气
    '的', '地', '得', '了', '着', '过', '吗', '呢', '吧', '啊', '呀', '哦', '啦',
    // 系词 / 助动词 / 否定
    '是', '在', '有', '没', '没有', '不', '别', '无', '要', '会', '能', '可以', '应该',
    '需要', '就是', '还是', '也是', '都是',
    // 连词 / 介词
    '和', '与', '跟', '或', '而', '且', '但', '但是', '却', '因为', '所以', '然后',
    '而且', '如果', '虽然', '于是', '把', '被', '给', '让', '使', '对', '从', '向',
    '往', '到', '于', '为', '用',
    // 程度 / 频率 / 范围
    '也', '都', '就', '又', '再', '还', '很', '太', '更', '最', '才', '只', '一直',
    '总是', '一个', '一样', '一些', '所有', '一切', '时候', '现在', '已经', '知道',
    '觉得', '感觉', '一起',
    // 英文里同样没有区分度的那些
    'the', 'and', 'of', 'to', 'in', 'on', 'at', 'as', 'an', 'be', 'by', 'if', 'or',
    'is', 'it', 'we', 'me', 'my', 'up', 'so', 'no', 'do', 'am', 'are', 'was', 'you',
    'your', 'this', 'that', 'what', 'when', 'not',
]);

/** 能当证据用的那部分高亮词：去掉单字，再去掉上面那张表里的虚词。 */
export const highlightEvidenceWords = (words: readonly string[]): string[] => (
    words
        .map(word => flattenForMatch(word))
        .filter(word => word.length >= MIN_EVIDENCE_WORD_LENGTH
            && !NON_EVIDENCE_WORDS.has(word))
);

/** 证据词的**总数与命中数**。判定与排序都只看这两个数，不再看整份词表。 */
const evidenceHits = (words: readonly string[], lyricText: string): { total: number; hits: number } => {
    const evidence = highlightEvidenceWords(words);
    const haystack = flattenForMatch(lyricText);
    if (evidence.length === 0 || !haystack) {
        return { total: evidence.length, hits: 0 };
    }
    let hits = 0;
    evidence.forEach((needle) => {
        if (haystack.includes(needle)) hits += 1;
    });
    return { total: evidence.length, hits };
};

/** 你手上这段歌词里**命中了几个**证据词。 */
export const countHighlightWordHits = (words: readonly string[], lyricText: string): number => (
    evidenceHits(words, lyricText).hits
);

/**
 * 高亮词的**覆盖率**：命中数 / 证据词数（0~1）。
 *
 * 一条证据都没有时是 0 —— 那不是「全都命中了」（0/0），是「没有凭据」。
 * 「一条都不合规时挑最像的那条」那一档用它 —— 那里已经没有是非，只有谁更像；
 * 判**合不合规**要看个数，不看比例（见 highlightWordsPresent）。
 */
export const highlightWordsCoverage = (words: readonly string[], lyricText: string): number => {
    const { total, hits } = evidenceHits(words, lyricText);
    return total === 0 ? 0 : hits / total;
};

/**
 * 最多允许缺几个词：不管挑了多少个词，缺超过这个数就当「这条答案不是照着这首歌做的」。
 *
 * 以前是「覆盖率 ≥ 80%」，那是**按比例**放宽 —— 词越多能缺得越多（10 个词缺 2 个、
 * 20 个词缺 4 个都过）。同一首歌的翻唱 / 现场 / 各平台 LRC 本来就共享大半的高亮词，
 * 于是拿一首近亲的歌词去撞另一首的答案也能撞上八成：用户报的正是「明明是另一首歌，
 * 居然匹配上了」。改成**按个数**之后，差多少就是差多少，词多不再等于可以差更多。
 *
 * 仍留着这一个的宽容：同一首歌的两份 LRC 差一个词（一句口白、翻译行不同、多一个空格
 * 之外的差别）就整条判死，用户看到的是「歌词明明一样，云缓存就是拉不到」。
 */
const HIGHLIGHT_WORD_MAX_MISSING = 1;
/**
 * 词到了这个数才给「缺一个」这个宽容：不足五个词时必须**全中**。
 *
 * 两个词里缺一个就是只中一半 —— 那不是「差一点」，是「这条答案跟这首的关系只有一半」，
 * 按比例放宽的年代正是这种短词表被放过去的。
 *
 * ⚠️ **别把「词少的答案」一刀切否掉**（试过：少于两个词一律不合规）—— 模型常常就只挑
 * 一两个词，那样一否，十几条近亲**全部**不合规，只好走「强制拿一条」那条路，拿回来的
 * 是高亮词完全不对的一份，上机的结果是**所有歌**的高亮词显示都错。词少照样放行（全中
 * 即可），只是不给「缺一个」这个宽容。
 */
const HIGHLIGHT_WORD_RELAX_MIN_WORDS = 5;

export const highlightWordsPresent = (words: readonly string[], lyricText: string): boolean => {
    const { total, hits } = evidenceHits(words, lyricText);
    /* 一个证据词都没有：没有凭据说明它属于这首歌。 */
    if (total === 0) return false;
    if (hits >= total) return true;
    if (hits <= 0) return false;
    return total >= HIGHLIGHT_WORD_RELAX_MIN_WORDS
        && total - hits <= HIGHLIGHT_WORD_MAX_MISSING;
};

/**
 * 一次 GET，把原始 payload 交回调用方（校验是调用方的事）。
 *
 * 只有「按已知键直接取一条」这种用法要它 —— 其余一律走 `pullAiCloudCache`，
 * 那条路还会按歌名兜底一层。
 */
export const fetchEntry = async (kind: AiCloudCacheKind, key: string): Promise<unknown> => {
    try {
        const response = await createAiFetch()(resolveAiCloudCacheUrl(kind, key), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: withTimeout(),
        });
        if (!response.ok) return null;
        const data = await response.json().catch(() => null) as { hit?: unknown; entry?: unknown } | null;
        const entry = data?.entry;
        if (data?.hit !== true || !isPlainObject(entry) || !('payload' in entry)) return null;
        return entry.payload;
    } catch {
        return null;
    }
};

const fetchResolveCandidates = async (
    kind: AiCloudCacheKind,
    songTitle: string,
): Promise<ResolveCandidate[]> => {
    try {
        const response = await createAiFetch()(resolveAiCloudResolveUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ kind, songTitle }),
            signal: withTimeout(),
        });
        if (!response.ok) return [];
        const data = await response.json().catch(() => null) as { candidates?: unknown } | null;
        const list = Array.isArray(data?.candidates) ? data?.candidates : [];
        const out: ResolveCandidate[] = [];
        list.forEach((entry: unknown) => {
            if (!isPlainObject(entry)) return;
            const key = String(entry.key ?? '').trim().toLowerCase();
            if (!/^[a-f0-9]{32}$/.test(key)) return;
            const words = Array.isArray(entry.words)
                ? entry.words.filter((word): word is string => typeof word === 'string' && word.trim().length > 0)
                : [];
            out.push({ key, words });
        });
        return out;
    } catch {
        return [];
    }
};

/**
 * 强制匹配那一批：从**随机**一处开始取前几条。
 *
 * 随机是用户要的（「匹配不上就随机选一个作为候选」）—— 一圈近亲里谁都不比谁更「是」这首
 * 歌，挑第一条反而会让每次都拿到同一条最旧的。多取几条是为了某一条已经被删了时不至于
 * 空手而归；它们只是候选，取到第一条有内容的就收。
 */
/**
 * 兜底下限：有歌词可判时，一条候选至少要有**一半**的证据词在场，才配得上「强制匹配」。
 *
 * 一条都不合规时挑**最像**的那几条：按高亮词的覆盖率从高到低取前 N 条。
 *
 * 以前这里是**随机**挑一条。随机等于承认「眼前的十几条近亲跟这首的关系都一样」——
 * 但它们并不一样：覆盖率 0.7 那条明显比 0.1 那条更像这首的答案，随机挑则两条机会
 * 均等，挑到最不像的那条时拉回来的就是一份照着别一首歌挑的高亮词，歌词上该亮的一
 * 个都亮不起来（用户报「歌曲墙上一个 AI 高亮都没有」，而这份数据还将回填到本次的
 * 精确键上，之后每次都是精确命中 —— 错一次就一直错下去）。
 *
 * ⚠️ **光挑「最像的」还不够 —— 全都一点不像时，最像的那条照样是错的**。
 * 用户接着报的就是这个：高亮词 `留住 / 我 / 什么 / 把 / 你` 里，「留住」和「把」在这首的
 * 歌词里根本不存在，覆盖率是「我 / 什么 / 你」这三个任何一首歌都有的词撑到 3/5 的 ——
 * 它连旧的 80% 门槛都进不去（所以不走合规判定），却在兜底里以「最像的那条」被挑走，
 * 然后回填到精确键上，错一次就一直错下去。所以给兜底设一条下限：**一条证据词都对不
 * 上的候选不参与兜底**，宁可回一句「云端没有」，让本机照这首歌重新生成。
 *
 * 下限取 0.5 而不是更高：同一首歌的两份 LRC 差一个词（模型只挑了两个证据词、其中一个
 * 换了写法）时是 1/2，那正是兜底这条路的来由，不该被门槛挡在外面。
 *
 * 「一个词都没标」的老条目（服务端没给 words）无从判，仍然照旧参与兜底 —— 它们不是
 * 「判出来不像」，是「没得判」，和没有歌词那一档同理。
 *
 * 覆盖率一样时留着服务端给的顺序（歌名全等优先、更新时间倒序），所以排序是稳定的。
 * 手上没有歌词时无从判，退化成「取最靠前那几条」，不会因此变成 miss。
 */
const FORCED_EVIDENCE_COVERAGE_MIN = 0.5;

const pickBestEffortCandidates = (
    candidates: readonly ResolveCandidate[],
    lyricText: string,
): ResolveCandidate[] => {
    if (candidates.length === 0) return [];
    if (!lyricText) {
        return candidates.slice(0, MAX_CONCURRENT_ENTRY_FETCHES);
    }
    const ranked = candidates
        .map((candidate, index) => ({
            candidate,
            index,
            // 没标词的条目无从判：留着，别让它因为「算出来 0」被门槛扫掉。
            judgeable: candidate.words.length > 0,
            coverage: highlightWordsCoverage(candidate.words, lyricText),
        }))
        .filter(entry => !entry.judgeable || entry.coverage >= FORCED_EVIDENCE_COVERAGE_MIN)
        .sort((a, b) => b.coverage - a.coverage || a.index - b.index);
    return ranked.slice(0, MAX_CONCURRENT_ENTRY_FETCHES).map(entry => entry.candidate);
};

export interface AiCloudCachePushMeta {
    songTitle?: string;
    target?: AiCompletionTarget | null;
    /**
     * 这首歌来自哪个音乐平台（netease / qq / kugou …）。
     *
     * 服务端拿它去对应平台把歌词原文件取回来重算哈希；**本地歌曲没有平台**，那就留空，
     * 服务端会按顺序逐个平台试。这个字段只跟着上传走 —— 拉取那条链路照样只看 MD5 键，
     * 于是加了它也不影响早先推上去的那些条目。
     */
    platform?: string;
    /**
     * 歌词正文的 MD5（不含 policy）。
     *
     * 缓存键是「歌词 + policy」的 MD5，policy 里的屏蔽样式与自定义提示词只有本机能算，
     * 服务端算不出来 —— 所以另外带一份纯歌词的哈希给它对。老版本没有这个字段，
     * 服务端就按「无从校验」放行。
     */
    lyricHash?: string;
    /** 纯音乐：喂给模型的（也参与指纹的）是歌名而不是歌词正文。 */
    isPureMusic?: boolean;
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

/**
 * 拉一次：先按精确键问，没中再按**歌名**捞一条内容合规的。
 *
 * 键是「歌词 + policy」的 MD5，于是同一首歌换个版本的歌词就是另一个键 —— 翻唱、现场、
 * 平台之间同一首歌的 LRC 本来就不一样。只赌精确键的话，「库里明明躺着答案却取不到」
 * 是常态。所以第二次机会不看哈希，改看内容：候选条目标的高亮词都在你手上这段歌词里，
 * 那条答案就是照着这首歌做的。**一条都对不上也不再报没命中** —— 改为强制挑一条
 * （见下面那段注释）：宁可拿一条近亲的答案，也不要说「云端没有」。
 *
 * 出错一律当「没命中」，调用方照常生成。
 */
export const pullAiCloudCache = async (
    kind: AiCloudCacheKind,
    key: string,
    meta: { songTitle?: string; lyricText?: string } = {},
): Promise<AiCloudCachePull> => {
    if (!isFoliaCloudCacheEnabled()) return { status: 'unavailable' };
    if (!/^[a-f0-9]{32}$/.test(key)) return { status: 'unavailable' };
    if (wasRecentMiss(kind, key)) return { status: 'miss' };

    const url = resolveAiCloudCacheUrl(kind, key);
    let data: { hit?: unknown; entry?: unknown } | null = null;

    /*
     * 安卓先问原生。
     *
     * 那一次请求由 OkHttp 发出、答案留在原生侧，于是「网页发起 → 后台被冻住」这一整段
     * 都不再参与：原生把活干完，网页哪一步回来问都能拿到。没有这个方法（老版本 App）
     * 就照旧走下面那条。
     */
    /*
     * 整段包住，不只是 reject：取那个导出本身也可能抛（模块没加载出来时是同步的），
     * 而缓存的纪律是**永不阻塞功能** —— 这里出任何岔子都只是「这次没命中」。
     */
    let native: { ok: boolean; body: string } | null = null;
    try {
        native = await fetchAiCacheViaNative(key, url);
    } catch {
        native = null;
    }
    if (native) {
        /* 原生真发了请求、服务端说没有：那就是没命中，不必再用网页那条再问一遍。 */
        if (!native.ok) return { status: 'miss' };
        /* 原生回的是响应体原文：解析不出来就跟没命中一样，别让一条脏响应炸了整条链路。 */
        try {
            data = JSON.parse(native.body) as { hit?: unknown; entry?: unknown };
        } catch {
            data = null;
        }
    }

    if (!data) {
        try {
            const response = await createAiFetch()(url, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: withTimeout(),
            });
            /* 没命中不再当场返回 —— 下面还有一次按歌名捞的机会。 */
            if (response.ok) {
                data = await response.json().catch(() => null) as { hit?: unknown; entry?: unknown } | null;
            }
        } catch {
            data = null;
        }
    }

    const entry = data?.entry;
    if (data?.hit === true && isPlainObject(entry) && 'payload' in entry) {
        return { status: 'hit', payload: entry.payload, matched: 'exact' };
    }

    /*
     * 第二次机会：**不看哈希，看内容**。
     *
     * 服务端按歌名把同类条目的高亮词送回来（小得多的响应），本机拿自己这段歌词逐条判
     * —— 那条答案标的词全都在这儿，它就是照着这首歌做的，哪怕两份 LRC 差几个字。
     * 判定留在本机，歌词正文一次都不用上传。
     */
    const songTitle = String(meta.songTitle ?? '').trim();
    if (!songTitle) {
        rememberMiss(kind, key);
        return { status: 'miss' };
    }

    const candidates = await fetchResolveCandidates(kind, songTitle);
    if (candidates.length === 0) {
        rememberMiss(kind, key);
        return { status: 'miss' };
    }

    /*
     * 有歌词才判合规。
     *
     * 没有歌词（主题只按歌名存的那一路、纯音乐）无从判 —— 那就直接走下面那条强制的路，
     * 而不是像以前那样当场记一次「没命中」：那样这一首本次会话再也不会问第二次，用户
     * 看到的就是「云端明明有，就是匹配不上」。
     */
    const lyricText = String(meta.lyricText ?? '');

    /*
     * 合规判定**一次做齐**，再去发请求。
     *
     * 歌名一样、歌词不一样的歌本来就是一堆近亲（翻唱、现场、各平台的 LRC 差几个字
     * 就是一个新键），候选一次能来十来个。原来是「判一个高亮词 → 拉一次」挨着串行，
     * 前面只要有一个慢、或者卡到 12 秒超时，后面明明合规的那条就一直排不上 —— 用户
     * 等的就是这一段。判定是本机字符串比较，零成本，先全筛完再一起问。
     */
    const eligible = lyricText
        ? candidates.filter((candidate) => highlightWordsPresent(candidate.words, lyricText))
        : [];

    /*
     * 一条都不合规 → **强制匹配**：挑最像的那一条用。
     *
     * 以前这一步是「判不过就当没命中」，于是用户撞上的是那句最让人恼火的话：这一屏明明是
     * 从云端那批歌名里点进来的、云端确实躺着这一首的答案，播下去却一点没变。原因只是各平台
     * 的 LRC 差几个字 —— 高亮词差一两个，整条候选就被判成「另一首歌」。
     *
     * 用户要的就是「反正没有出现的词也无所谓」：词少几个不影响这是不是同一首歌的配色。
     * 所以这里不再返回 miss，改从候选里挑**高亮词覆盖率最高**的那条（见
     * pickBestEffortCandidates）。
     *
     * ⚠️ 但兜底不是「无论如何都要拿一条」：一条证据词都对不上的候选不参与兜底
     * （下限见 pickBestEffortCandidates），那样会是 miss —— 拿一条照着别的歌做的高亮词
     * 当这首的主题，比承认「云端没有」糟得多。
     *
     * ⚠️ 兜底挑来的那条**不回填**（matched 记成 'forced'，调用方只回填 'words'）。
     * 它本来就是「没验证上」才走的兜底，回填到精确键上就变成永久事实 ——
     * 一次猜错，这首歌以后每次都是那一份错的高亮词。宁可下次再走一遍「搜歌名 + 逐条判」，
     * 也不把猜测写成结论。
     */
    const forced = eligible.length === 0;
    const batch = forced
        ? pickBestEffortCandidates(candidates, lyricText)
        : eligible.slice(0, MAX_CONCURRENT_ENTRY_FETCHES);

    const payloads = await Promise.all(
        batch.map((candidate) => fetchEntry(kind, candidate.key)),
    );
    /*
     * 取**顺序最靠前**的那个成功的：合规那一批服务端已经按「歌名完全相等优先、更新时间
     * 倒序」排过了，所以这里不必再挑，第一个到手的就是最该用的那条。
     */
    const index = payloads.findIndex((payload) => payload !== null);
    if (index >= 0) {
        return {
            status: 'hit',
            payload: payloads[index],
            /* 兜底挑来的不算「内容合规」：调用方据此决定要不要回填（见下）。 */
            matched: forced ? 'forced' : 'words',
            sourceKey: batch[index].key,
        };
    }

    rememberMiss(kind, key);
    return { status: 'miss' };
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
                platform: meta.platform ?? '',
                lyricHash: meta.lyricHash ?? '',
                isPureMusic: meta.isPureMusic === true,
            }),
            signal: withTimeout(),
        });
        if (response.ok) forgetMiss(kind, key);
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
    /**
     * 只生成出一半时，把云端已有的另一半并进去再回传。
     *
     * 部署端点与 Electron 这两条路只能出主题，出不了动画决策。不合并就整条覆盖，
     * 等于把别人推上来的完整条目抹成半截 —— 之后不管谁拉这条，动画那半永远是空的，
     * 导演于是再也没法切换样式，而缓存里明明有别人做好的决策。
     *
     * 传进来的 `previous` 是**没通过 validate** 的 payload（缺的正是这次要的那半），
     * 所以它照样要过一遍校验，脏数据不能跟着一起回传。
     */
    combine?: (previous: unknown, fresh: T) => T;
    songTitle?: string;
    /** 见 `AiCloudCachePushMeta`：平台名与歌词哈希只跟着上传走，不参与键。 */
    platform?: string;
    /** 歌词正文的 MD5。算得出来就带上，服务端好拿平台上的歌词对一遍。 */
    lyricHash?: string;
    /** 歌词正文。只用在「精确键没中」那一次兜底判定上，**不会上传**。 */
    lyricText?: string;
    isPureMusic?: boolean;
    /**
     * 别去问云端，直接生成 —— 「重新判断」就是要一个跟缓存里不一样的答案。
     *
     * 少了这一条，force 只是跳过了进程内缓存，云端那份照样命中，用户点
     * 「重新判断」永远是同一个结果。
     */
    skipPull?: boolean;
}): Promise<{ value: T; source: AiCloudCacheSource }> => {
    const { kind, fingerprint, generate, validate, combine, songTitle, platform, lyricHash, lyricText, isPureMusic, skipPull } = options;

    let previous: unknown = null;
    if (!skipPull && isFoliaCloudCacheEnabled()) {
        const pulled = await pullAiCloudCache(kind, fingerprint, {
            songTitle,
            /* 纯音乐那半的「歌词」其实是歌名，别拿它去判高亮词。 */
            lyricText: isPureMusic ? '' : lyricText,
        });
        const validated = pulled.status === 'hit' ? validate(pulled.payload) : null;
        if (validated !== null) {
            /*
             * 按内容捞到的那条**回填**到自己这个键上。
             *
             * 同一份歌词下次还是同一个键 —— 不回填就得再走一遍「搜歌名 + 逐条判」，
             * 白花两次往返。回填的是库里已有的答案（不是新生成的），落哪个键都不影响
             * 别人，而命中率会实打实地涨。回填失败无所谓：反正这一次已经命中了。
             */
            if (pulled.status === 'hit' && pulled.matched === 'words') {
                void pushAiCloudCache(kind, fingerprint, validated, {
                    songTitle,
                    platform,
                    lyricHash,
                    isPureMusic,
                    target: describeAiTarget(),
                }).catch(() => false);
            }
            return { value: validated, source: 'cloud' };
        }
        /*
         * 没通过校验的那份也要留着 —— 它缺的正是这次要问的那一半，但它**有**这次
         * 生成不出来的那一半。丢掉就等于把已有的成果擦掉。
         */
        if (pulled.status === 'hit') previous = pulled.payload;
    }

    const value = await generate();
    void pushAiCloudCache(
        kind,
        fingerprint,
        combine ? combine(previous, value) : value,
        { songTitle, platform, lyricHash, isPureMusic, target: describeAiTarget() },
    );
    return { value, source: 'ai' };
};
