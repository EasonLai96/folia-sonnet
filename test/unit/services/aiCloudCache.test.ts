// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/services/aiCloudCache.test.ts
// 精确键没命中时，还能不能靠**歌名 + 内容合规**把库里那条答案捞出来。
//
// 键是「歌词 + policy」的 MD5，于是同一首歌换个版本的歌词就是另一个键 —— 翻唱、现场、
// 平台之间同一首歌的 LRC 本来就不一样。只赌精确键的话，「库里明明躺着答案却取不到」
// 是常态，这也是「缓存命中率还是有问题」的来处。
//
// 第二次机会**不看哈希，看内容**：候选条目标的高亮词都在你手上这段歌词里，那条答案
// 就是照着这首歌做的。判定留在本机（服务端只回高亮词），歌词正文因此不用上传。
//
// 但高亮词只是**挑**的依据，不是门槛：一条都对不上时改为**强制拿一条**（挑最像的那个候选），
// 不再报「没有」—— 各平台的 LRC 差几个字就该判成另一首歌，这是用户最恼火的那一句
// 「云端明明有，就是匹配不上」。

const { handlers } = vi.hoisted(() => ({
  handlers: {
    fetch: null as null | ((url: string, init?: RequestInit) => Promise<Response>),
  },
}));

vi.mock('@/services/foliaCloud', () => ({
  isFoliaCloudCacheEnabled: () => true,
  resolveCloudApiUrl: (path: string) => `https://cloud.test/api/${path}`,
  DEFAULT_CLOUD_BASE_URL: 'https://cloud.test',
}));

vi.mock('@/services/aiNativeFetch', () => ({
  createAiFetch: () => (input: RequestInfo | URL, init?: RequestInit) =>
    (handlers.fetch as NonNullable<typeof handlers.fetch>)(String(input), init),
  fetchAiCacheViaNative: async () => null,
}));

vi.mock('@/services/aiCompletion', () => ({
  describeAiTarget: () => null,
}));

const { highlightWordsPresent, pullAiCloudCache, withAiCloudCache } = await import('@/services/aiCloudCache');

const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);
/*
 * 每个用例用自己的键：`missCache` 会把「刚问过没有」记 5 分钟，共用一把键的话后面
 * 的用例会被 `wasRecentMiss` 当场挡掉，看起来通过其实根本没走到兜底逻辑。
 */
const KEY_C = 'c'.repeat(32);
const KEY_D = 'd'.repeat(32);
const KEY_E = 'e'.repeat(32);
const KEY_F = 'f'.repeat(32);
const KEY_G = 'a1b2c3d4'.repeat(4);
const KEY_H = 'd4e5f6a7'.repeat(4);
/* 每个用例用自己的键：missCache 会把「刚问过没有」记 5 分钟，复用会当场被挡掉。 */
const KEY_I = 'e6f7a8b9'.repeat(4);
const KEY_PUSHED = 'a2b3c4d5'.repeat(4);
const KEY_J = 'a7b8c9d0'.repeat(4);
const KEY_K = 'b1c2d3e4'.repeat(4);
const KEY_L = 'c5d6e7f8'.repeat(4);

const payload = {
  theme: {
    light: { backgroundColor: '#111111', primaryColor: '#222222', wordColors: [{ word: '小黄花', color: '#ffcc00' }] },
    dark: { backgroundColor: '#000000', primaryColor: '#eeeeee', wordColors: [{ word: '小黄花', color: '#ffcc00' }] },
  },
  decision: { mode: 'flow', reason: 'r', params: {} },
};

const secondPayload = {
  ...payload,
  decision: { mode: 'bloom', reason: 'r2', params: {} },
};

const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body }) as unknown as Response;

beforeEach(() => {
  handlers.fetch = null;
});

describe('highlightWordsPresent', () => {
  const lyric = '故事的小黄花\n童年的荡秋千';

  it('is satisfied when every marked word is in the lyric', () => {
    expect(highlightWordsPresent(['小黄花', '荡秋千'], lyric)).toBe(true);
  });

  /* LRC 里多一个空格不该判成「这不是同一个词」。 */
  it('ignores whitespace and case', () => {
    expect(highlightWordsPresent(['小 黄 花', '故事'], '故事的小黄花')).toBe(true);
    expect(highlightWordsPresent(['Rainbow', 'here'], 'some RAINBOW here')).toBe(true);
  });

  /*
   * 词少照样能合规（全中即可）—— 但**不按比例放宽**。
   *
   * ⚠️ 反过来（「少于 N 个词一律判不合规」）试过，上机是**所有歌**的高亮词显示都错：
   * 模型常常只挑一两个词，一刀切之后十几条近亲全部不合规，只好走「强制拿一条」，
   * 拿回来的高亮词完全不对。词少的答案不许一刀切，只能要求它全中。
   */
  it('still takes a short list when every one of its words is there', () => {
    expect(highlightWordsPresent(['小黄花'], lyric)).toBe(true);
    expect(highlightWordsPresent(['故事'], '故事的小黄花')).toBe(true);
  });

  /* 不到五个词：差一个就不行（4 个差 1 = 75%）。到了五个才给「缺一个」这个宽容。 */
  it('lets a word go missing once there are five of them', () => {
    expect(highlightWordsPresent(['故事', '小黄花', '童年', '不在'], lyric)).toBe(false);
    expect(highlightWordsPresent(['故事', '小黄花', '童年', '荡秋千', '不在歌词里'], lyric)).toBe(true);
    expect(highlightWordsPresent(['故事', '小黄花', '童年', '不在', '也不在'], lyric)).toBe(false);
  });

  it('is not satisfied when a word is missing', () => {
    expect(highlightWordsPresent(['小黄花', '根本不在这首歌里'], lyric)).toBe(false);
  });

  /*
   * 词多**不再**等于可以多缺几个。
   *
   * 以前按覆盖率放行（≥80%）：10 个词缺 2 个、20 个词缺 4 个照样过。而同一首歌的翻唱 /
   * 现场 / 各平台 LRC 本来就共享大半的高亮词，于是拿一首近亲的歌词去撞另一首的答案也
   * 能撞上八成 —— 用户报的正是「明明是另一首歌，居然匹配上了」。现在按**个数**判，
   * 不管挑了多少个词，最多只缺一个。
   */
  it('counts the missing words instead of taking a percentage', () => {
    const many = '甲乙丙丁戊己庚辛壬癸';
    /* 用双字：单字在任何歌里都能撞上，不当证据（见下面那条用例）。 */
    const words = ['甲乙', '丙丁', '戊己', '庚辛', '壬癸'];

    expect(highlightWordsPresent(words, many)).toBe(true);
    /* 缺 1 个：同一首歌的两份 LRC 差一个词（口白 / 翻译行）不该整条判死。 */
    expect(highlightWordsPresent([...words.slice(0, 4), '不在'], many)).toBe(true);
    /* 缺 2 个：覆盖率正好 60%，旧规则按比例（80%）也不放行，现在更不行。 */
    expect(highlightWordsPresent([...words.slice(0, 3), '不在', '也不在'], many)).toBe(false);
  });

  /*
   * 单字不算证据：「我 / 你 / 把」在几乎每一首中文歌里都有，它们出现在歌词里说明不了
   * 这条答案是照着哪首歌词做的。
   */
  it('does not count single characters as evidence', () => {
    const lyric2 = '我你他把什么都在这里面';
    expect(highlightWordsPresent(['我', '你', '把'], lyric2)).toBe(false);
    /* 换成从歌词里挑出来的实词，同样三个词就合规了。 */
    expect(highlightWordsPresent(['绚烂', '闪躲', '告别'], '世界变得更绚烂\n所有告别\n无论我怎么闪躲')).toBe(true);
  });

  /*
   * 用户报的那个真例子：候选的高亮词是 留住 / 我 / 什么 / 把 / 你，
   * 而这首的歌词里「留住」和「把」根本不存在 —— 覆盖率 3/5 全靠三个虚词撑着。
   * 去掉虚词与单字之后证据只剩「留住」，一个都没命中，不该算匹配。
   */
  it('does not take an answer whose only evidence is missing from the lyric', () => {
    const lyric2 = [
      '可那些与我无关',
      '麻烦总缠着我',
      '什么也不想说',
      '让我重新认识一个更好的你',
      '因为你陪着我',
    ].join('\n');

    expect(highlightWordsPresent(['留住', '我', '什么', '把', '你'], lyric2)).toBe(false);
    /* 光是「我 / 什么 / 你」这三个虚词命中，一点都不算证据。 */
    expect(highlightWordsPresent(['我', '什么', '你'], lyric2)).toBe(false);
    /* 同一段歌词，换成真的从里面挑出来的词就合规。 */
    expect(highlightWordsPresent(['麻烦', '重新认识', '好天气'], lyric2 + '\n就像大雨过后的好天气')).toBe(true);
  });

  /*
   * 一个高亮词都没有时不算合规 —— 反过来实现等于「随便一条答案都能算命中」，
   * 会把别人给别的歌做的主题套到你这首上。
   */
  it('needs at least one word to go on', () => {
    expect(highlightWordsPresent([], lyric)).toBe(false);
    expect(highlightWordsPresent(['小黄花'], '')).toBe(false);
  });
});

describe('pullAiCloudCache 的第二次机会', () => {
  it('takes a title match whose highlight words are all in the lyric', async () => {
    const seen: string[] = [];
    handlers.fetch = async (url) => {
      seen.push(url);
      if (url.includes('/ai-cache/resolve')) {
        return json({ ok: true, candidates: [{ key: KEY_A, words: ['小黄花'] }] });
      }
      if (url.includes(KEY_A)) return json({ hit: true, entry: { payload } });
      return json({ hit: false }, false);
    };

    const result = await pullAiCloudCache('stage', KEY_B, {
      songTitle: '晴天',
      lyricText: '故事的小黄花\n从出生那年就飘着',
    });

    expect(result.status).toBe('hit');
    if (result.status === 'hit') {
      expect(result.matched).toBe('words');
      expect(result.sourceKey).toBe(KEY_A);
      expect(result.payload).toEqual(payload);
    }
    /* 顺带钉住顺序：先精确，再 resolve，最后按候选的键取回。 */
    expect(seen[0]).toContain(KEY_B);
    expect(seen[1]).toContain('/ai-cache/resolve');
    expect(seen[2]).toContain(KEY_A);
  });

  /*
   * 高亮词只是**挑**的依据，不是门槛：一条都对得上时按它排，一条都对不上时**强制拿一条**。
   *
   * 以前这一步是「判不过就当没命中」，用户撞上的是那句最恼火的话 —— 这一屏明明是从云端
   * 那批歌名里点进来的、云端确实躺着这一首的答案，播下去却一点没变；原因只是各平台的 LRC
   * 差几个字。词少几个不影响这是不是同一首歌的配色（用户原话「反正没有出现的词也无所谓」）。
   */
  /*
   * 一条证据都对不上时**不再**强制匹配：那是「判出来不像」，不是「没得判」。
   *
   * 以前是「反正挑最像的那条」,于是另一首近亲的答案会被顶上来，还回填到这首的精确键上
   * —— 用户报的就是这个（高亮词 留住/我/什么/把/你 里前两个根本不在歌词里）。
   * 现在该老实说「云端没有」，让本机照这首重新生成。
   */
  it('gives up instead of forcing a match when no candidate has any evidence', async () => {
    /*
     * 候选那一键**是给了内容的** —— 这一条要验的是判定本身，不是「接口没给」。
     * 少了 `url.includes(KEY_A)` 这一支，测试会因为别的原因通过，把实现改坏也不红。
     */
    handlers.fetch = async (url) => {
      if (url.includes('/ai-cache/resolve')) {
        return json({ ok: true, candidates: [{ key: KEY_A, words: ['小黄花'] }] });
      }
      if (url.includes(KEY_A)) return json({ hit: true, entry: { payload } });
      return json({ hit: false }, false);
    };

    const result = await pullAiCloudCache('stage', KEY_C, {
      songTitle: '晴天',
      lyricText: '完全不同的一首歌',
    });

    expect(result.status).toBe('miss');
  });

  /* 虚词凑出来的「命中」同样不算证据：整个候选里没有一个实词对得上。 */
  it('gives up when the only words that match are filler', async () => {
    handlers.fetch = async (url) => {
      if (url.includes('/ai-cache/resolve')) {
        return json({ ok: true, candidates: [{ key: KEY_A, words: ['留住', '我', '什么', '把', '你'] }] });
      }
      if (url.includes(KEY_A)) return json({ hit: true, entry: { payload } });
      return json({ hit: false }, false);
    };

    const result = await pullAiCloudCache('stage', KEY_K, {
      songTitle: '风清云净',
      lyricText: '可那些与我无关\n麻烦总缠着我\n什么也不想说\n让我重新认识一个更好的你',
    });

    expect(result.status).toBe('miss');
  });

  /*
   * 都判不过时挑**最像**的那条（高亮词覆盖率最高），不再随便挑一条。
   *
   * 随机等于承认「眼前的十几条近亲跟这首的关系都一样」—— 它们并不一样：覆盖率 0.67 那条
   * 明显比 0 那条更像这首的答案。而挑到的那条会回填到本次的精确键上，错一次就一直错下去。
   */
  it('falls back to the closest candidate, not an arbitrary one', async () => {
    handlers.fetch = async (url) => {
      if (url.includes('/ai-cache/resolve')) {
        return json({
          ok: true,
          candidates: [
            { key: KEY_A, words: ['完全不在', '也不在'] },                  // 0/2
            { key: KEY_H, words: ['小黄花', '不在歌词里'] },                 // 1/2
            { key: KEY_B, words: ['小黄花', '荡秋千', '不在这段里'] },       // 2/3 —— 最高的那条
          ],
        });
      }
      if (url.includes(KEY_B)) return json({ hit: true, entry: { payload } });
      if (url.includes(KEY_A) || url.includes(KEY_H)) return json({ hit: true, entry: { payload: secondPayload } });
      return json({ hit: false }, false);
    };

    const result = await pullAiCloudCache('stage', KEY_G, {
      songTitle: '晴天',
      lyricText: '故事的小黄花\n童年的荡秋千',
    });

    expect(result.status).toBe('hit');
    if (result.status === 'hit') {
      /* 走的是兜底：记成 'forced'，调用方据此不把它回填到精确键上。 */
      expect(result.matched).toBe('forced');
      expect(result.sourceKey).toBe(KEY_B);
      expect(result.payload).toEqual(payload);
    }
  });

  /*
   * 兜底挑来的不回填：它本来就没验证上，写成精确键等于把一次猜测钉成永久事实 ——
   * 下次、下下次，这首永远拿这份可能是别首歌的答案。
   */
  it('does not write a forced pick back under the exact key', async () => {
    const puts: string[] = [];
    handlers.fetch = async (url, init) => {
      if (url.includes('/ai-cache/resolve')) {
        return json({ ok: true, candidates: [{ key: KEY_A, words: ['小黄花', '不在歌词里'] }] });
      }
      if (init?.method === 'PUT') {
        puts.push(String(init.body ?? ''));
        return json({ ok: true, stored: true });
      }
      if (url.includes(KEY_A)) return json({ hit: true, entry: { payload } });
      return json({ hit: false }, false);
    };

    const result = await withAiCloudCache({
      kind: 'stage',
      fingerprint: KEY_L,
      /* 兜底命中就不该轮到模型，也不该有 PUT。 */
      generate: async () => { throw new Error('不该轮到模型'); },
      validate: (value) => (value && typeof value === 'object' ? value as Record<string, unknown> : null),
      songTitle: '晴天',
      lyricText: '故事的小黄花',
    });

    expect(result.source).toBe('cloud');
    expect(puts).toHaveLength(0);
  });

  /* 一条高亮词都没标的候选：也走强制匹配那条路，不再整条出局。 */
  it('forces a match even when no candidate marked any word', async () => {
    handlers.fetch = async (url) => {
      if (url.includes('/ai-cache/resolve')) {
        return json({ ok: true, candidates: [{ key: KEY_A, words: [] }] });
      }
      /* 内容照样给：只有「真取不到内容」才该轮到 miss。 */
      if (url.includes(KEY_A)) return json({ hit: true, entry: { payload } });
      return json({ hit: false }, false);
    };

    const result = await pullAiCloudCache('stage', KEY_D, { songTitle: '晴天', lyricText: '故事的小黄花' });
    expect(result.status).toBe('hit');
    if (result.status === 'hit') {
      expect(result.sourceKey).toBe(KEY_A);
    }
  });

  /* 没歌名就无从下手，老老实实按没命中走。 */
  it('gives up quietly when there is nothing to judge against', async () => {
    handlers.fetch = async () => json({ hit: false }, false);

    expect(await pullAiCloudCache('stage', KEY_E, { songTitle: '', lyricText: '故事的小黄花' })).toEqual({ status: 'miss' });
  });

  /*
   * 没有歌词可判（主题只按「歌名 + 歌手」存的那一路、纯音乐）也**照样**走强制匹配。
   *
   * 以前这一支在「没有歌词」时就当场记一次 miss 返回 —— 于是那一路本次会话再也不会问
   * 第二次，从「AI 主题」那一屏点播放看到的正是「云端明明有，就是匹配不上」。
   */
  it('forces a match when there is no lyric to judge against', async () => {
    handlers.fetch = async (url) => {
      if (url.includes('/ai-cache/resolve')) {
        return json({ ok: true, candidates: [{ key: KEY_A, words: ['小黄花'] }] });
      }
      if (url.includes(KEY_A)) return json({ hit: true, entry: { payload } });
      return json({ hit: false }, false);
    };

    const result = await pullAiCloudCache('theme', KEY_J, { songTitle: '晴天' });
    expect(result.status).toBe('hit');
    if (result.status === 'hit') {
      expect(result.sourceKey).toBe(KEY_A);
      expect(result.payload).toEqual(payload);
    }
  });

  /*
   * 歌名一样、歌词不一样的一堆近亲，候选一次能来十来个 —— 挨着串行的话，前面有一个
   * 慢（或卡到超时）就把后面明明合规的那条拖住。判定是本机字符串比较，先全筛完再
   * 一起问。
   */
  it('asks every eligible candidate at once instead of one after another', async () => {
    const seen: string[] = [];
    handlers.fetch = async (url) => {
      seen.push(url);
      if (url.includes('/ai-cache/resolve')) {
        return json({
          ok: true,
          candidates: [
            // 每条至少两个词：一个词定不了「这是照着这首歌做的答案」，见 highlightWordsPresent。
            { key: KEY_A, words: ['小黄花', '故事'] },
            { key: KEY_H, words: ['荡秋千', '童年'] },
          ],
        });
      }
      if (url.includes(KEY_A)) return json({ hit: true, entry: { payload } });
      if (url.includes(KEY_H)) return json({ hit: true, entry: { payload: secondPayload } });
      return json({ hit: false }, false);
    };

    const result = await pullAiCloudCache('stage', KEY_I, {
      songTitle: '晴天',
      lyricText: '故事的小黄花\n童年的荡秋千',
    });

    expect(result.status).toBe('hit');
    if (result.status === 'hit') {
      expect(result.matched).toBe('words');
      /* 服务端已经按「歌名全等优先、更新时间倒序」排过 —— 取最靠前那条。 */
      expect(result.sourceKey).toBe(KEY_A);
      expect(result.payload).toEqual(payload);
    }
    /* 串行那条路问到第一个就返回了 —— 第二个也被问过才说明是一起发的。 */
    expect(seen.some((url) => url.includes(KEY_A))).toBe(true);
    expect(seen.some((url) => url.includes(KEY_H))).toBe(true);
  });

  it('answers from the exact key without ever asking for candidates', async () => {
    const seen: string[] = [];
    handlers.fetch = async (url) => {
      seen.push(url);
      return json({ hit: true, entry: { payload } });
    };

    const result = await pullAiCloudCache('stage', KEY_F, { songTitle: '晴天', lyricText: '故事的小黄花' });

    if (result.status === 'hit') expect(result.matched).toBe('exact');
    expect(seen.some((url) => url.includes('/ai-cache/resolve'))).toBe(false);
  });
});

describe('推上去之后自己要还能拉到', () => {
  /*
   * 推上去的那一键，本地必须立刻忘掉「刚才问过没有」。
   *
   * 队列播完从头再来一轮时最容易撞上：第一遍生成完把答案推上云端，本地 missCache
   * 却还记着「5 分钟前这个键没有」—— 切回来时 pull 被这条 miss 直接挡掉，**连 GET
   * 都不发**，于是又烧一次模型，而「已从云端拉取缓存」这句提示永远说不出来。
   */
  it('asks again after the answer was pushed, instead of calling it missing forever', async () => {
    let stored = false;
    const seen: string[] = [];
    handlers.fetch = async (url, init) => {
      seen.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === 'PUT') {
        stored = true;
        return json({ ok: true, stored: true });
      }
      if (url.includes('/ai-cache/resolve')) return json({ ok: true, candidates: [] });
      if (url.includes(KEY_PUSHED) && stored) return json({ hit: true, entry: { payload } });
      return json({ hit: false }, false);
    };

    /* 第一遍：云端没有 → 生成 → 推上去。 */
    const first = await withAiCloudCache({
      kind: 'stage',
      fingerprint: KEY_PUSHED,
      generate: async () => payload,
      validate: (value) => (value && typeof value === 'object' ? value as Record<string, unknown> : null),
      songTitle: '晴天',
      lyricText: '故事的小黄花',
    });
    expect(first.source).toBe('ai');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stored).toBe(true);

    /* 第二遍（切走再切回来 / 队列循环回来）：必须真的去问一次，并且命中。 */
    const before = seen.length;
    const second = await pullAiCloudCache('stage', KEY_PUSHED, {
      songTitle: '晴天',
      lyricText: '故事的小黄花',
    });

    expect(second.status).toBe('hit');
    /* 被 missCache 挡掉的话这里一个请求都不会有。 */
    expect(seen.length).toBeGreaterThan(before);
  });
});

describe('withAiCloudCache 把按内容捞到的那条回填', () => {
  /*
   * 同一份歌词下次还是同一个键 —— 不回填就得再走一遍「搜歌名 + 逐条判」，白花两次
   * 往返。回填之后下一次是精确命中，命中率才会真的涨上去。
   */
  it('writes the borrowed answer back under the exact key', async () => {
    const puts: string[] = [];
    handlers.fetch = async (url, init) => {
      if (url.includes('/ai-cache/resolve')) {
        return json({ ok: true, candidates: [{ key: KEY_A, words: ['小黄花'] }] });
      }
      if (init?.method === 'PUT') {
        puts.push(String(init.body ?? ''));
        return json({ ok: true, stored: true });
      }
      if (url.includes(KEY_A)) return json({ hit: true, entry: { payload } });
      return json({ hit: false }, false);
    };

    const result = await withAiCloudCache({
      kind: 'stage',
      fingerprint: KEY_G,
      generate: async () => { throw new Error('不该轮到模型'); },
      validate: (value) => (value && typeof value === 'object' ? value as Record<string, unknown> : null),
      songTitle: '晴天',
      lyricText: '故事的小黄花',
    });

    expect(result.source).toBe('cloud');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0]).payload).toEqual(payload);
  });
});
