import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJsonWithRetry, fetchWithTimeout } from '@/utils/fetchWithTimeout';

// test/unit/utils/fetchWithTimeout.test.ts
// #596：调用方带了自己的 signal 时，超时也要报成「Request timed out」的普通 Error（fetchJsonWithRetry 据此重试），
// 只有调用方自己 abort 才是 AbortError（不重试）。没带 signal 的老路径不变。fetch 用假的：不应答，直到 signal 被 abort。

const URL_UNDER_TEST = 'https://example.test/song.json';

// 一个永远不应答的 fetch：只在 signal abort 时以 AbortError 拒绝，和浏览器里被取消的请求一样。
const hangingFetch = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
    }, { once: true });
});

const okJson = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
});

describe('fetchWithTimeout', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('reports a timeout as a plain Error even when the caller passes its own signal', async () => {
        vi.stubGlobal('fetch', vi.fn(hangingFetch));
        const controller = new AbortController();

        const pending = fetchWithTimeout(URL_UNDER_TEST, { signal: controller.signal }, 1_000);
        const settled = pending.then(() => null, (error: unknown) => error);
        await vi.advanceTimersByTimeAsync(1_000);
        const error = await settled;

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).name).toBe('Error');
        expect((error as Error).message).toBe(`Request timed out after 1000ms: ${URL_UNDER_TEST}`);
        expect((error as Error).cause).toBeInstanceOf(DOMException);
        expect(controller.signal.aborted).toBe(false);
    });

    it('still rejects with AbortError when the caller aborts its own signal', async () => {
        vi.stubGlobal('fetch', vi.fn(hangingFetch));
        const controller = new AbortController();

        const pending = fetchWithTimeout(URL_UNDER_TEST, { signal: controller.signal }, 1_000);
        const settled = pending.then(() => null, (error: unknown) => error);
        await vi.advanceTimersByTimeAsync(200);
        controller.abort();
        const error = await settled;

        expect((error as Error).name).toBe('AbortError');
        // 取消之后超时计时器已清掉，不会再晚到一个超时。
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects with AbortError without fetching when the caller signal is already aborted', async () => {
        const fetchMock = vi.fn(hangingFetch);
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();
        controller.abort();

        await expect(fetchWithTimeout(URL_UNDER_TEST, { signal: controller.signal }, 1_000))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    // 回归：没带 signal 的路径原本就报超时，行为不变。
    it('keeps reporting a timeout without a caller signal', async () => {
        vi.stubGlobal('fetch', vi.fn(hangingFetch));

        const pending = fetchWithTimeout(URL_UNDER_TEST, {}, 1_000);
        const settled = pending.then(() => null, (error: unknown) => error);
        await vi.advanceTimersByTimeAsync(1_000);
        const error = await settled;

        expect((error as Error).name).toBe('Error');
        expect((error as Error).message).toBe(`Request timed out after 1000ms: ${URL_UNDER_TEST}`);
    });

    it('returns the response when fetch answers in time without a caller signal', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okJson({ ok: true }))));

        const response = await fetchWithTimeout(URL_UNDER_TEST, {}, 1_000);

        expect(response.status).toBe(200);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('fetchJsonWithRetry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('retries after a timeout when the caller passes its own signal', async () => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockImplementationOnce(hangingFetch)
            .mockImplementationOnce(() => Promise.resolve(okJson({ url: 'https://cdn.test/a.mp3' })));
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();

        const pending = fetchJsonWithRetry<{ url: string }>(
            URL_UNDER_TEST,
            { signal: controller.signal },
            { timeoutMs: 1_000, retries: 1, retryDelayMs: 500 },
        );
        await vi.advanceTimersByTimeAsync(1_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(500);

        await expect(pending).resolves.toEqual({ url: 'https://cdn.test/a.mp3' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry when the caller aborts its own signal', async () => {
        const fetchMock = vi.fn<typeof fetch>(hangingFetch);
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();

        const pending = fetchJsonWithRetry(
            URL_UNDER_TEST,
            { signal: controller.signal },
            { timeoutMs: 1_000, retries: 2, retryDelayMs: 500 },
        );
        const settled = pending.then(() => null, (error: unknown) => error);
        await vi.advanceTimersByTimeAsync(100);
        controller.abort();
        const error = await settled;
        await vi.advanceTimersByTimeAsync(5_000);

        expect((error as Error).name).toBe('AbortError');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
