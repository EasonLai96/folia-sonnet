// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestAiCompletion } from '@/services/aiCompletion';

// 当前文件：DeepSeek 必须走 OpenAI 兼容端点。
//
// 它是 OpenAI 兼容的，但**有自己的 provider id** —— 不是 'openai'。任何写成
// `provider === 'openai'` 的分支判断都会把它分到 Gemini 那半去，于是读空的
// geminiApiKey 并抛「未配置」。
//
// 用户能撞到的样子：设置里「测试连接」成功（那条路认的是 isOpenAiCompatibleProvider），
// 点「生成」却说没配置密钥 —— 同一份设置，两条路结论相反。

const state = vi.hoisted(() => ({ urls: [] as string[] }));

vi.mock('@/services/aiNativeFetch', () => ({
    createAiFetch: () => async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        state.urls.push(url);
        /* 两家回包的形状不一样，按端点给，免得解析那一步先炸了，测不到路由。 */
        const body = url.includes('generativelanguage.googleapis.com')
            ? { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }
            : { choices: [{ message: { content: '{"ok":true}' } }] };
        return { ok: true, status: 200, json: async () => body } as unknown as Response;
    },
}));

beforeEach(() => {
    state.urls.length = 0;
    localStorage.setItem('foliaAiProviderSettings', JSON.stringify({
        provider: 'deepseek',
        deepseekApiKey: 'sk-test',
        /* Gemini 那半故意留空：一旦路由走错，这里就会让请求发不出去。 */
        geminiApiKey: '',
    }));
});

describe('AI 供应商路由', () => {
    it('DeepSeek 发往 DeepSeek 的端点，不是 Gemini 的', async () => {
        const result = await requestAiCompletion({ system: 's', prompt: 'p', json: true });

        expect(result.target.provider).toBe('deepseek');
        expect(state.urls.some((url) => url.includes('api.deepseek.com'))).toBe(true);
        expect(state.urls.some((url) => url.includes('generativelanguage.googleapis.com'))).toBe(false);
    });

    it('Gemini 仍然发往 Gemini 的端点', async () => {
        localStorage.setItem('foliaAiProviderSettings', JSON.stringify({
            provider: 'gemini',
            geminiApiKey: 'gk-test',
        }));

        const result = await requestAiCompletion({ system: 's', prompt: 'p', json: true });

        expect(result.target.provider).toBe('gemini');
        expect(state.urls.some((url) => url.includes('generativelanguage.googleapis.com'))).toBe(true);
    });
});
