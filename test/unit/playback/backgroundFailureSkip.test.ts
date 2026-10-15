import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState } from '@/types';
import type { PlaybackFailure } from '@/types/playbackFailure';

// test/unit/playback/backgroundFailureSkip.test.ts
// 后台播放出错的两条纪律：
//   1. 不排倒计时 —— 后台的 timer 会被节流甚至整页冻结，「5 秒后自动跳过」可能永远不来。
//   2. 系统气泡要说清原因 —— 界面那会儿没人看，提示条要等回前台才显示。

const showNativeToast = vi.fn();
vi.mock('@/platform/foliaNative', () => ({
    showNativeToast: (text: string, options?: { long?: boolean }) => {
        showNativeToast(text, options);
        return Promise.resolve();
    },
}));

const background = { suspended: false };
vi.mock('@/utils/backgroundRenderGate', () => ({
    isBackgroundRenderSuspended: () => background.suspended,
}));

vi.mock('@/services/onlineMusic/omni', () => ({
    omni: { getProviderLabel: () => 'QQ 音乐' },
}));

const { presentPlaybackFailure } = await import('@/components/app/playback/presentPlaybackFailure');
const { resetBackgroundPlaybackNoticeDedupe } = await import('@/services/playbackRecovery/backgroundFailureNotice');

const failure = (reason: PlaybackFailure['reason']): PlaybackFailure => ({ reason, stage: 'resolve-url' });

const createHarness = () => {
    const setStatusMsg = vi.fn();
    const setPlayerState = vi.fn();
    const showTimedSkipPrompt = vi.fn();
    const audio = { pause: vi.fn() };
    const deps = {
        t: (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key),
        setStatusMsg,
        setPlayerState,
        audioRef: { current: audio },
        shouldAutoPlayRef: { current: true },
        setIsLyricsLoading: vi.fn(),
        showTimedSkipPrompt,
        maxAutoSkipCount: 4,
    };
    return { deps, setStatusMsg, setPlayerState, showTimedSkipPrompt, audio };
};

describe('presentPlaybackFailure while the interface is in the background', () => {
    beforeEach(() => {
        showNativeToast.mockClear();
        background.suspended = true;
        resetBackgroundPlaybackNoticeDedupe();
    });

    it('skips at once instead of starting a countdown, and says why in a toast', () => {
        const { deps, showTimedSkipPrompt } = createHarness();
        const skip = vi.fn();
        presentPlaybackFailure({
            failure: failure('preview-only'),
            context: 'play',
            isCurrent: () => true,
            skipCount: 0,
            skip,
        }, deps);

        expect(skip).toHaveBeenCalledTimes(1);
        expect(showTimedSkipPrompt).not.toHaveBeenCalled();
        expect(showNativeToast).toHaveBeenCalledTimes(1);
        expect(showNativeToast.mock.calls[0][0]).toContain('status.songPreviewOnly');
        expect(showNativeToast.mock.calls[0][0]).toContain('status.autoSkippedNext');
    });

    it('skips for whole-platform failures too (a preview-only account still wants the next song)', () => {
        for (const reason of ['not-signed-in', 'session-expired', 'network', 'timeout', 'service-unavailable', 'rate-limited'] as const) {
            showNativeToast.mockClear();
            const { deps } = createHarness();
            const skip = vi.fn();
            presentPlaybackFailure({
                failure: failure(reason),
                context: 'play',
                isCurrent: () => true,
                skipCount: 0,
                skip,
            }, deps);
            expect(skip, reason).toHaveBeenCalledTimes(1);
            expect(showNativeToast, reason).toHaveBeenCalledTimes(1);
        }
    });

    it('stops after the one-song budget of a whole-platform failure', () => {
        const { deps, setPlayerState } = createHarness();
        const skip = vi.fn();
        presentPlaybackFailure({
            failure: failure('session-expired'),
            context: 'play',
            isCurrent: () => true,
            skipCount: 1,
            skip,
        }, deps);

        // 没登录时跳一首就够了，再跳是在后台一首接一首地空转。
        expect(skip).not.toHaveBeenCalled();
        expect(setPlayerState).toHaveBeenCalledWith(PlayerState.IDLE);
        // 停下来了也要说一声，否则用户连「为什么没声了」都不知道。
        expect(showNativeToast).toHaveBeenCalledTimes(1);
    });

    it('keeps going through several broken songs when each one is its own problem', () => {
        const { deps } = createHarness();
        const skip = vi.fn();
        presentPlaybackFailure({
            failure: failure('preview-only'),
            context: 'play',
            isCurrent: () => true,
            skipCount: 3,
            skip,
        }, deps);
        expect(skip).toHaveBeenCalledTimes(1);
    });

    it('does not skip a request that has already been superseded', () => {
        const { deps } = createHarness();
        const skip = vi.fn();
        presentPlaybackFailure({
            failure: failure('preview-only'),
            context: 'play',
            isCurrent: () => false,
            skipCount: 0,
            skip,
        }, deps);
        expect(skip).not.toHaveBeenCalled();
    });

    it('does not repeat the same message within the dedupe window', () => {
        const skip = vi.fn();
        const input = { failure: failure('preview-only'), context: 'play' as const, isCurrent: () => true, skipCount: 0, skip };
        presentPlaybackFailure(input, createHarness().deps);
        presentPlaybackFailure(input, createHarness().deps);
        expect(showNativeToast).toHaveBeenCalledTimes(1);
    });
});

describe('presentPlaybackFailure while the interface is visible', () => {
    beforeEach(() => {
        showNativeToast.mockClear();
        background.suspended = false;
        resetBackgroundPlaybackNoticeDedupe();
    });

    it('counts down and leaves the toast alone', () => {
        const { deps, showTimedSkipPrompt, setPlayerState } = createHarness();
        const skip = vi.fn();
        presentPlaybackFailure({
            failure: failure('preview-only'),
            context: 'play',
            isCurrent: () => true,
            skipCount: 0,
            skip,
        }, deps);

        expect(showTimedSkipPrompt).toHaveBeenCalledTimes(1);
        expect(skip).not.toHaveBeenCalled();
        expect(setPlayerState).not.toHaveBeenCalled();
        expect(showNativeToast).not.toHaveBeenCalled();
    });
});
