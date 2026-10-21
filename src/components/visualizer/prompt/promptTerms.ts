import { fetchEntry, listAiCloudCacheSongs } from '../../../services/aiCloudCache';

// src/components/visualizer/prompt/promptTerms.ts
// 输入框上方那行「提示词」的取词：AI 云缓存里随机几首歌的高亮标记（主题的 wordColors）。
//
// 为什么要一个进程内快照：输入框是在播放中同步搭出来的，不能 await。所以这里只负责
// 「异步去云端抓一把，攒在模块里」，搭框时同步读。抓不到就用调用方给的本首高亮词，
// 再不行用几个中性词 —— 「提示词」永远有字，不会空着。

/** 云端一首歌都没拿到、本首主题也没有高亮词时的兜底。 */
const FALLBACK_TERMS = ['context', 'attention', 'token', 'sampling', 'prompt', 'completion'];

const TERM_TTL_MS = 10 * 60 * 1000;
const MAX_POOL = 80;
const MAX_TERM_LENGTH = 16;
/** 一次读几首（每首一条云端缓存）。多了就是白花流量。 */
const SAMPLE_SONGS = 3;

let pool: string[] = [];
let inflight: Promise<void> | null = null;
let lastFetchAt = 0;

/** 缓存条目的形状不可信（服务端谁都能推），所以按字段名往下探，见到 wordColors 就收。 */
const collectWords = (value: unknown, depth = 0): string[] => {
    if (depth > 4 || !value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.flatMap(item => collectWords(item, depth + 1));
    const record = value as Record<string, unknown>;
    const words: string[] = [];
    const wordColors = record.wordColors;
    if (Array.isArray(wordColors)) {
        wordColors.forEach(entry => {
            if (!entry || typeof entry !== 'object') return;
            const word = String((entry as Record<string, unknown>).word ?? '').trim();
            if (word) words.push(word);
        });
    }
    Object.keys(record).forEach(key => {
        if (key === 'wordColors') return;
        words.push(...collectWords(record[key], depth + 1));
    });
    return words;
};

const unique = (values: string[]): string[] => {
    const seen = new Set<string>();
    const output: string[] = [];
    values.forEach(value => {
        const key = value.normalize('NFC');
        if (seen.has(key)) return;
        seen.add(key);
        output.push(value);
    });
    return output;
};

/**
 * 去云端抓一把别的歌的高亮词。失败、未开启、离线一律静默 —— 这只是装饰。
 * 同一个 TTL 内只抓一次；正在抓的时候重入直接复用那一次。
 */
export const refreshPromptTerms = async (): Promise<void> => {
    if (inflight) return inflight;
    if (Date.now() - lastFetchAt < TERM_TTL_MS) return;
    inflight = (async () => {
        try {
            const page = await listAiCloudCacheSongs({ limit: 24 });
            const keys = page.songs.map(song => song.key).filter(Boolean);
            if (keys.length === 0) return;
            // 「随机一首」：起点随机，然后顺序取，尽量取到不同的歌。
            const start = Math.floor(Math.random() * keys.length);
            const picked: string[] = [];
            for (let index = 0; index < keys.length && picked.length < SAMPLE_SONGS; index += 1) {
                const key = keys[(start + index) % keys.length];
                if (!picked.includes(key)) picked.push(key);
            }
            const entries = await Promise.all(picked.map(key => fetchEntry('theme', key).catch(() => null)));
            const words = unique(entries.flatMap(entry => collectWords(entry)))
                .filter(word => word.length <= MAX_TERM_LENGTH);
            if (words.length === 0) return;
            pool = words.slice(0, MAX_POOL);
            lastFetchAt = Date.now();
        } catch {
            // 缓存拉不到就当没有：下次还会试。
        } finally {
            inflight = null;
        }
    })();
    return inflight;
};

/**
 * 同步取一行提示词。`own` 是本首主题自己的高亮词（排在前面，至少这一首是准的）。
 * 种子决定取哪几个，所以同一句每次重绘都取到同一行（seek 安全），换一句就换一批 ——
 * 也就是每个新飞进来的框，提示词都不一样。
 */
export const samplePromptTerms = (
    own: readonly string[],
    seed: number,
    count = 5,
): string[] => {
    const local = own
        .map(word => String(word ?? '').trim())
        .filter(word => word.length > 0 && word.length <= MAX_TERM_LENGTH);
    const source = unique([...local, ...pool]);
    const base = source.length > 0 ? source : FALLBACK_TERMS;
    if (base.length <= count) return base;
    const start = Math.abs(Math.trunc(seed)) % base.length;
    return Array.from({ length: count }, (_, index) => base[(start + index) % base.length]);
};
