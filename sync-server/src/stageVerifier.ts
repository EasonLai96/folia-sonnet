import { md5 } from './md5.js';
import { lyricTextCandidates, readLyricTextForPlatform, LYRIC_SOURCE_LABELS } from './stageLyricSources.js';

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
    /** verified = 与平台上的歌词对上了；unverified = 无从验证（放行，但不算数）。 */
    status: 'verified' | 'unverified';
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

  const { text, source } = await readLyricTextForPlatform(platformName, songTitle);

  /* 平台上没有这首歌、或者接口这会儿不通：放行，只记成「没验证过」。 */
  if (!text) {
    return {
      ok: true,
      status: 'unverified',
      platform: platformName,
      source: null,
      note: platformName
        ? `${label || platformName} 上没取到这首歌的歌词，无从校验。`
        : '各个平台都没取到这首歌的歌词，无从校验。',
    };
  }

  const matched = lyricTextCandidates(text).some((candidate) => md5(candidate) === hash);
  if (!matched) {
    return {
      ok: false,
      error: 'lyric_mismatch',
      note: `${source ? (LYRIC_SOURCE_LABELS[source] ?? source) : '平台'}上的歌词与上传的哈希对不上。`,
    };
  }

  return {
    ok: true,
    status: 'verified',
    platform: platformName,
    source,
    note: `已与${source ? (LYRIC_SOURCE_LABELS[source] ?? source) : '平台'}上的歌词核对一致。`,
  };
};
