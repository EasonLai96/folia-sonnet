// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestStage } from '@/services/aiStage';

// 当前文件：`source` 说的是**这次结果从哪来**，界面靠它选提示文案。
//
//  'cloud' = 这会儿没调模型，用的是别人推上去（或云端既有）的那份；
//  'ai'    = 这台机器刚真的问了一次模型。
//
// 进程内去重命中时不能一律标 'cloud' —— 那一次的答案正是这台机器刚算出来的，标成
// cloud 会让刚生成完的用户看到「已从云端拉取缓存」，而这一句本来是留给「白拿别人的」
// 那种情况。两条链路（主题、导演）共用同一个指纹，撞的就是这一层。

const state = vi.hoisted(() => ({ payload: null as unknown }));

vi.mock('@/services/aiNativeFetch', () => ({
    createAiFetch: () => async () => ({
        ok: true,
        status: 200,
        json: async () => (state.payload === null
            ? { hit: false }
            : { hit: true, entry: { payload: state.payload } }),
    } as unknown as Response),
}));

/* 一台「有密钥、能生成」的机器。 */
vi.mock('@/services/aiCompletion', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/aiCompletion')>();
    const theme = {
        light: { name: 'gen-light', backgroundColor: '#ffffff', primaryColor: '#111111' },
        dark: { name: 'gen-dark', backgroundColor: '#000000', primaryColor: '#eeeeee' },
    };
    return {
        ...actual,
        requestAiCompletion: async () => ({
            text: JSON.stringify({ theme, mode: 'sonnet', reason: 'r', params: {} }),
            target: { provider: 'gemini', model: 'm' },
        }),
    };
});

const lines = (a: string, b: string) => [{ fullText: a }, { fullText: b }];

beforeEach(() => {
    state.payload = null;
    localStorage.setItem('foliaCloudSettings.v2', JSON.stringify({
        enabled: true,
        baseUrl: 'https://cloud.test',
    }));
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('stage 结果的来源标签', () => {
    it('自己刚生成完的，不能说成是从云端拉的', async () => {
        const shared = { lines: lines('这一首的第一句', '这一首的第二句'), songTitle: '甲' };

        const themeRun = await requestStage({ ...shared, require: 'theme' });
        expect(themeRun.source).toBe('ai');

        /*
         * 导演这条链路接着问同一段歌词，命中进程内「刚算完」那份。
         * 那份是这台机器生成的，来源就该还是 'ai'。
         */
        const directorRun = await requestStage({ ...shared, require: 'decision' });
        expect(directorRun.source).toBe('ai');
        expect(directorRun.decision?.mode).toBe('sonnet');
    });

    it('真从云端拿到的才标成云端', async () => {
        state.payload = {
            theme: {
                light: { name: 'cached-light', backgroundColor: '#ffffff', primaryColor: '#111111' },
                dark: { name: 'cached-dark', backgroundColor: '#000000', primaryColor: '#eeeeee' },
            },
            decision: { mode: 'sonnet', reason: 'r', params: {} },
        };

        const result = await requestStage({
            lines: lines('另一首的第一句', '另一首的第二句'),
            songTitle: '乙',
            require: 'theme',
        });

        expect(result.source).toBe('cloud');
        expect(result.theme?.light?.name).toBe('cached-light');
    });
});
