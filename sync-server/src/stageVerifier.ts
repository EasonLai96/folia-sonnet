import { md5 } from './md5.js';
import { lyricTextCandidates, searchLyricCandidates, LYRIC_SOURCE_LABELS } from './stageLyricSources.js';

// sync-server/src/stageVerifier.ts
// 一条上传到底收不收：空数据一律拒，形状不合规一律拒，能验的再拿平台上的歌词原文件
// 把哈希重算一遍。
//
// 上传接口是公开的（没填 Key 的人也要能把自己那份推上来），所以「有人拿空数据把别人
// 做好的那条盖掉」迟早会发生。备份解决的是事后能捞回来，这里解决的是别让它进来。
//
// 两条纪律：
//  1. **空数据一律拒绝**，没有例外。
//  2. **平台取不到歌词时放行**：第三方接口随时会不通，而缓存的纪律是永不阻塞功能 ——
//     取不到只记成「没验证过」，不能让一次上游抖动把正常上传卡死。

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const hasUsableColors = (theme: unknown): boolean => {
  if (!isRecord(theme)) return false;
  return typeof theme.backgroundColor === 'string'
    || typeof theme.primaryColor === 'string'
    || typeof theme.accentColor === 'string';
};

/** 一份 payload 里到底有没有东西：主题和动画决策至少得有一半站得住。 */
export const isStagePayloadEmpty = (payload: unknown): boolean => {
  if (payload === null || payload === undefined) return true;
  if (Array.isArray(payload)) return payload.length === 0;
  if (!isRecord(payload)) return true;

  const theme = isRecord(payload.theme) ? payload.theme : null;
  const hasTheme = Boolean(theme && (hasUsableColors(theme.light) || hasUsableColors(theme.dark)));

  const decision = isRecord(payload.decision) ? payload.decision : payload;
  const mode = typeof decision.mode === 'string' ? decision.mode.trim() : '';

  return !hasTheme && !mode;
};

export type StageUploadVerification =
  | {
    ok: true;
    /**
     * - verified     = 与平台上这首歌的歌词哈希对上了；
     * - word_matched = 哈希对不上，但**内容合规**：AI 标记的高亮词在这首歌的歌词里都在；
     * - unverified   = 无从验证（放行，但不算数）。
     */
    status: 'verified' | 'word_matched' | 'unverified';
    platform: string;
    source: string | null;
    note: string;
  }
  | {
    ok: false;
    error: 'empty_payload' | 'invalid_payload' | 'lyric_mismatch';
    note: string;
  };

const HASH_PATTERN = /^[a-f0-9]{32}$/;

const collectWords = (value: unknown, out: Set<string>): void => {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const word = typeof entry.word === 'string' ? entry.word.trim() : '';
    if (word) out.add(word);
  }
};

/**
 * 这条答案里 AI 标记的**高亮词**。
 *
 * 形状是 `theme.light.wordColors` / `theme.dark.wordColors`（`{ word, color }[]`）。主题
 * 也可能只有一层（早先推的条目），那就连 theme 自身那层一起找 —— 找到几个算几个。
 */
export const readHighlightWords = (payload: unknown): string[] => {
  const buckets: unknown[] = [];
  if (isRecord(payload)) {
    const theme = isRecord(payload.theme) ? payload.theme : payload;
    buckets.push(theme.wordColors);
    if (isRecord(theme.light)) buckets.push(theme.light.wordColors);
    if (isRecord(theme.dark)) buckets.push(theme.dark.wordColors);
  }
  const words = new Set<string>();
  buckets.forEach((bucket) => collectWords(bucket, words));
  return [...words];
};

/** 比的时候不看空白与大小写：LRC 里多一个空格不该判成「这不是同一个词」。 */
const flattenForMatch = (value: string): string => (
  String(value ?? '').replace(/\s+/g, '').toLowerCase()
);

/**
 * 「合规」：AI 标记的高亮词在这首歌的歌词里**全都找得到**。
 *
 * 高亮词是模型照着歌词挑出来的 —— 一条照着别的歌做的答案，不可能把这首的词挑出来。
 * 所以这比哈希宽松（容忍同一首歌的不同版本），又比「一律放行」严格得多。
 *
 * 一个高亮词都没有时不算合规：哈希已经对不上了，再没有任何证据说明它属于这首歌。
 */
export const highlightWordsPresent = (words: readonly string[], lyricText: string): boolean => {
  if (words.length === 0) return false;
  const haystack = flattenForMatch(lyricText);
  if (!haystack) return false;
  return words.every((word) => {
    const needle = flattenForMatch(word);
    return needle.length > 0 && haystack.includes(needle);
  });
};

export const verifyStageUpload = async (input: {
  payload: unknown;
  songTitle: string;
  platform: string;
  /** 客户端带来的「歌词正文 MD5」；老客户端没有，那就无从验证。 */
  lyricHash: string;
  isPureMusic?: boolean;
  /** 关掉之后只做空数据与合规检查（上游抖动时的退路）。 */
  strict: boolean;
}): Promise<StageUploadVerification> => {
  const { payload, songTitle, platform, lyricHash, isPureMusic, strict } = input;

  if (isStagePayloadEmpty(payload)) {
    return { ok: false, error: 'empty_payload', note: '空数据：既没有主题也没有动画决策。' };
  }

  if (!isRecord(payload)) {
    return { ok: false, error: 'invalid_payload', note: 'payload 不是对象。' };
  }

  const hash = String(lyricHash ?? '').trim().toLowerCase();
  const platformName = String(platform ?? '').trim();
  const label = LYRIC_SOURCE_LABELS[platformName.toLowerCase()] ?? '';

  if (!strict) {
    return { ok: true, status: 'unverified', platform: platformName, source: null, note: '校验已关闭。' };
  }

  /*
   * 没有哈希（老客户端推的）就没法比 —— 放行，但不算验证过。
   *
   * 兼容旧数据是硬要求：拉取那条链路照样只看 MD5 键，加了新字段也不影响它。
   */
  if (!HASH_PATTERN.test(hash)) {
    return {
      ok: true,
      status: 'unverified',
      platform: platformName,
      source: null,
      note: '这一条没带歌词哈希（旧客户端），无从校验来源。',
    };
  }

  /*
   * 纯音乐：指纹用的是**歌名**而不是歌词正文（客户端 resolveStageLyricSource），
   * 服务端自己就能重算，不必去平台问。
   */
  if (isPureMusic === true) {
    if (md5(String(songTitle ?? '').trim()) === hash) {
      return {
        ok: true,
        status: 'verified',
        platform: platformName,
        source: null,
        note: '纯音乐：指纹取自歌名，已核对。',
      };
    }
    return {
      ok: false,
      error: 'lyric_mismatch',
      note: '歌名与上传的哈希对不上。',
    };
  }

  /* 按歌名去平台上搜；搜不到（或者接口这会儿不通）就是无从校验。 */
  const { candidates, source } = await searchLyricCandidates(platformName, songTitle);

  /* 平台上没有这首歌、或者接口这会儿不通：放行，只记成「没验证过」。 */
  if (candidates.length === 0) {
    return {
      ok: true,
      status: 'unverified',
      platform: platformName,
      source: null,
      note: platformName
        ? `${label || platformName} 上没搜到这首歌，无从校验。`
        : '各个平台都没搜到这首歌，无从校验。',
    };
  }

  /*
   * 先比哈希，一首一首来。
   *
   * 同一首歌在平台上有好几个版本（翻唱、现场、别人重新传的 LRC），上传者手里那份未必
   * 是搜索结果里的第一条 —— 只比第一条会把大量正常上传误判成「不一致」。命中就停，
   * 后面几首的歌词一次都不拉。
   */
  for (const candidate of candidates) {
    const text = await candidate.readLyric();
    if (!text) continue;
    if (!lyricTextCandidates(text).some((variant) => md5(variant) === hash)) continue;
    return {
      ok: true,
      status: 'verified',
      platform: platformName,
      source,
      note: `已与${LYRIC_SOURCE_LABELS[candidate.source] ?? candidate.source}上《${candidate.title}》的歌词核对一致。`,
    };
  }

  /*
   * 哈希还是对不上 —— 再按**内容**判一次。
   *
   * 歌词版本不同不代表这条答案是假的：换了个版本的 LRC，哈希就变了，可它照样是照着
   * 这首歌做的。合规的标准就是用户定的那条：**答案里 AI 标记的高亮词，在这首歌的歌词
   * 里全都找得到**。挑得出这些词，就说明生成它时看的确实是这首歌。
   */
  const words = readHighlightWords(payload);
  if (words.length > 0) {
    for (const candidate of candidates) {
      const text = await candidate.readLyric();
      if (!text || !highlightWordsPresent(words, text)) continue;
      return {
        ok: true,
        status: 'word_matched',
        platform: platformName,
        source,
        note: `歌词版本与${LYRIC_SOURCE_LABELS[candidate.source] ?? candidate.source}上《${candidate.title}》不完全一致，但 AI 标记的 ${words.length} 个高亮词都在这首歌的歌词里。`,
      };
    }
  }

  return {
    ok: false,
    error: 'lyric_mismatch',
    note: words.length === 0
      ? `${source ? (LYRIC_SOURCE_LABELS[source] ?? source) : '平台'}上的歌词与上传的哈希对不上，而且这一条没有 AI 高亮词可以核对内容。`
      : `${source ? (LYRIC_SOURCE_LABELS[source] ?? source) : '平台'}上的歌词与上传的哈希对不上，AI 标记的 ${words.length} 个高亮词也没能在这首歌的歌词里找齐。`,
  };
};
