import { describe, expect, it, vi } from 'vitest';
import { waitForNativeArrival } from '@/components/app/playback/start/waitForNativeArrival';

// test/unit/playback/waitForNativeArrival.test.ts
// Pins the signal that keeps 「从歌单点歌只改名字」 from coming back: `playFromQueue` answering
// ok only means the native side took the order, the address is installed later. Only a native
// snapshot that already names the song counts as played; a timeout, a newer play, or a bridge
// that throws all mean "not taken" so the caller falls back to the Web flow and the name and the
// sound still change together.

const neverCalled = () => {
    throw new Error('readSnapshot should not be called');
};

describe('waitForNativeArrival —— 等原生真正装上这首歌', () => {
    it('快照第一次就报了这首歌，立刻认这一单，不再等', async () => {
        const sleep = vi.fn(async () => undefined);
        const arrived = await waitForNativeArrival({
            readSnapshot: async () => ({ songKey: 'online:netease:1' }),
            expectsKey: 'online:netease:1',
            sleep,
        });
        expect(arrived).toBe(true);
        expect(sleep).not.toHaveBeenCalled();
    });

    it('受理后地址还要几拍才回来，等到的那一拍返回 true', async () => {
        const keys = ['online:netease:0', 'online:netease:0', 'online:netease:1'];
        let index = 0;
        const arrived = await waitForNativeArrival({
            readSnapshot: async () => ({ songKey: keys[Math.min(index++, keys.length - 1)] }),
            expectsKey: 'online:netease:1',
            sleep: async () => undefined,
        });
        expect(arrived).toBe(true);
        expect(index).toBe(3);
    });

    it('一直没到就等到超时，返回 false（调用方据此回退 Web）', async () => {
        let clock = 0;
        const readSnapshot = vi.fn(async () => ({ songKey: 'online:netease:0' }));
        const arrived = await waitForNativeArrival({
            readSnapshot,
            expectsKey: 'online:netease:1',
            timeoutMs: 1000,
            intervalMs: 250,
            now: () => clock,
            sleep: async (ms) => { clock += ms; },
        });
        expect(arrived).toBe(false);
        expect(readSnapshot).toHaveBeenCalledTimes(4);
    });

    it('用户中途点了别的歌（stillWanted 变 false）就不再空等，也不再读快照', async () => {
        let wanted = true;
        let reads = 0;
        const arrived = await waitForNativeArrival({
            readSnapshot: async () => {
                reads += 1;
                wanted = false; // 读完这一拍之后被顶掉
                return { songKey: 'online:netease:0' };
            },
            expectsKey: 'online:netease:1',
            stillWanted: () => wanted,
            sleep: async () => undefined,
        });
        expect(arrived).toBe(false);
        expect(reads).toBe(1);
    });

    it('一上来就已经被顶掉，连快照都不读', async () => {
        const arrived = await waitForNativeArrival({
            readSnapshot: neverCalled,
            expectsKey: 'online:netease:1',
            stillWanted: () => false,
        });
        expect(arrived).toBe(false);
    });

    it('桥不可用（读快照抛错）当作没到，立刻返回 false 交给 Web 流程', async () => {
        const arrived = await waitForNativeArrival({
            readSnapshot: async () => {
                throw new Error('plugin not available');
            },
            expectsKey: 'online:netease:1',
            sleep: async () => undefined,
        });
        expect(arrived).toBe(false);
    });

    it('快照是 null / 没有 songKey 都不算到达', async () => {
        const snapshots: Array<{ songKey?: string } | null> = [null, {}, null];
        let index = 0;
        let clock = 0;
        const arrived = await waitForNativeArrival({
            readSnapshot: async () => snapshots[Math.min(index++, snapshots.length - 1)],
            expectsKey: 'online:netease:1',
            timeoutMs: 600,
            intervalMs: 250,
            now: () => clock,
            sleep: async (ms) => { clock += ms; },
        });
        expect(arrived).toBe(false);
    });
});
