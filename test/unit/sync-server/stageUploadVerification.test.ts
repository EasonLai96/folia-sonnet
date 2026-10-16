import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStagePayloadEmpty, verifyStageUpload } from '../../../sync-server/src/stageVerifier';
import { md5 } from '../../../sync-server/src/md5';
import { lyricTextCandidates } from '../../../sync-server/src/stageLyricSources';
import { resolveSongPlatform } from '../../../src/utils/songPlatform';
import type { SongResult } from '../../../src/types';

// test/unit/sync-server/stageUploadVerification.test.ts
// 一条上传收不收：空数据一律拒，能验的再拿平台上的歌词把哈希重算一遍。
//
// 上传接口是公开的，所以「有人拿空数据把别人做好的那条盖掉」是迟早会发生的事。
// 这里锁住的是那道门槛本身；平台取不到歌词时**必须放行**（缓存永不阻塞功能），
// 这条同样要钉住 —— 反过来实现会把一次上游抖动变成全站上传失败。

const goodPayload = {
  theme: {
    light: { backgroundColor: '#ffffff', primaryColor: '#111111', accentColor: '#ff0000', secondaryColor: '#00ff00' },
    dark: { backgroundColor: '#000000', primaryColor: '#eeeeee', accentColor: '#00ffff', secondaryColor: '#333333' },
  },
  decision: { mode: 'classic', reason: '均衡', params: {} },
};

/** 网易云那两个接口的假响应：搜索给一个 id，歌词给一段 LRC。 */
const stubNetease = (lyric: string) => {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    const body = url.includes('/api/search/get/web')
      ? JSON.stringify({ result: { songs: [{ id: 123, name: '晴天' }] } })
      : JSON.stringify({ lrc: { lyric } });
    return { ok: true, status: 200, text: async () => body } as unknown as Response;
  }));
};

const stubNoResult = () => {
  vi.stubGlobal('fetch', vi.fn(async () => (
    { ok: true, status: 200, text: async () => JSON.stringify({ result: { songs: [] } }) } as unknown as Response
  )));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('md5', () => {
  it('matches the published test vectors', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
  });

  /* 歌名与歌词都是中文：按 UTF-16 算出来的哈希和客户端对不上，校验就永远是「不一致」。 */
  it('encodes the input as UTF-8', () => {
    expect(md5('晴天')).toBe(md5('晴天'));
    expect(md5('晴天')).not.toBe(md5('晴'));
    expect(md5('晴天')).toHaveLength(32);
  });
});

describe('isStagePayloadEmpty', () => {
  it('rejects the shapes that carry nothing', () => {
    expect(isStagePayloadEmpty(null)).toBe(true);
    expect(isStagePayloadEmpty(undefined)).toBe(true);
    expect(isStagePayloadEmpty({})).toBe(true);
    expect(isStagePayloadEmpty([])).toBe(true);
    expect(isStagePayloadEmpty({ theme: {} })).toBe(true);
    /* 只有 decision 却没有 mode —— 等于什么都没说。 */
    expect(isStagePayloadEmpty({ decision: { reason: 'x' } })).toBe(true);
    expect(isStagePayloadEmpty({ decision: { mode: '   ' } })).toBe(true);
  });

  it('accepts a half entry, which is what old uploads look like', () => {
    expect(isStagePayloadEmpty({ theme: goodPayload.theme })).toBe(false);
    expect(isStagePayloadEmpty({ decision: { mode: 'classic' } })).toBe(false);
    expect(isStagePayloadEmpty(goodPayload)).toBe(false);
  });
});

describe('verifyStageUpload', () => {
  it('rejects empty payloads no matter what else is offered', async () => {
    const result = await verifyStageUpload({
      payload: { theme: {} },
      songTitle: '晴天',
      platform: 'netease',
      lyricHash: md5('la la la'),
      strict: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('empty_payload');
  });

  it('rejects an empty payload even when verification is switched off', async () => {
    const result = await verifyStageUpload({
      payload: null,
      songTitle: '晴天',
      platform: '',
      lyricHash: '',
      strict: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('empty_payload');
  });

  /*
   * 纯音乐的指纹取自**歌名**（客户端 resolveStageLyricSource），服务端自己就能重算，
   * 不必去平台问 —— 所以这种情况是唯一能严格判「不一致」的。
   */
  it('checks a pure-music entry against its title', async () => {
    const ok = await verifyStageUpload({
      payload: goodPayload,
      songTitle: '晴天',
      platform: '',
      lyricHash: md5('晴天'),
      isPureMusic: true,
      strict: true,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.status).toBe('verified');

    const bad = await verifyStageUpload({
      payload: goodPayload,
      songTitle: '晴天',
      platform: '',
      lyricHash: md5('别的歌'),
      isPureMusic: true,
      strict: true,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe('lyric_mismatch');
  });

  /* 旧客户端没有 lyricHash：无从校验，放行（但记成未验证）。 */
  it('lets an old upload through when there is nothing to check against', async () => {
    const result = await verifyStageUpload({
      payload: goodPayload,
      songTitle: '晴天',
      platform: '',
      lyricHash: '',
      strict: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe('unverified');
  });

  it('matches the lyric hash against the platform copy', async () => {
    stubNetease('[00:01.00]故事的小黄花\n[00:04.00]从出生那年就飘着');
    const lyricText = '故事的小黄花\n从出生那年就飘着';

    const result = await verifyStageUpload({
      payload: goodPayload,
      songTitle: '晴天',
      platform: 'netease',
      lyricHash: md5(lyricText),
      strict: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('verified');
      expect(result.source).toBe('netease');
    }
  });

  it('refuses when the platform copy hashes to something else', async () => {
    stubNetease('[00:01.00]完全不一样的一句词');

    const result = await verifyStageUpload({
      payload: goodPayload,
      songTitle: '晴天',
      platform: 'netease',
      lyricHash: md5('故事的小黄花'),
      strict: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('lyric_mismatch');
  });

  /*
   * 平台上没有这首歌、或者接口这会儿不通 —— 放行，只记成「没验证过」。
   * 这条是纪律：第三方接口抖一次不该变成全站上传失败。
   */
  it('lets it through when no platform has the song', async () => {
    stubNoResult();

    const result = await verifyStageUpload({
      payload: goodPayload,
      songTitle: '一首谁都没有的歌',
      platform: '',
      lyricHash: md5('la la la'),
      strict: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe('unverified');
  });
});

describe('lyricTextCandidates', () => {
  it('offers both the blank-keeping and the blank-stripped shape', () => {
    const candidates = lyricTextCandidates('第一行\n\n第二行');
    expect(candidates).toContain('第一行\n\n第二行');
    expect(candidates).toContain('第一行\n第二行');
  });

  it('has nothing to offer for blank lyrics', () => {
    expect(lyricTextCandidates('')).toEqual([]);
    expect(lyricTextCandidates('   \n  \n')).toEqual([]);
  });
});

describe('resolveSongPlatform', () => {
  it('reads the online provider id', () => {
    const song = { sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' } } as unknown as SongResult;
    expect(resolveSongPlatform(song)).toBe('netease');
  });

  /* 本地 / Navidrome / 舞台：没有平台可言，留空由服务端逐个平台试。 */
  it('has nothing to say about a local file', () => {
    expect(resolveSongPlatform({ sourceRef: { kind: 'local', mediaId: 'x' } } as unknown as SongResult)).toBe('');
    expect(resolveSongPlatform(null)).toBe('');
    expect(resolveSongPlatform(undefined)).toBe('');
    expect(resolveSongPlatform({} as SongResult)).toBe('');
  });
});
