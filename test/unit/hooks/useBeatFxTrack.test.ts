import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeatFxTrackBeats } from '../../../src/services/beatFx/beatFxSource';

// Exercises the beat-loading effect with a deferred cache lookup and native gate notifications.
const h = vi.hoisted(() => ({
    cleanups: [] as (() => void)[],
    listeners: new Set<() => void>(),
    song: { id: 'first' },
    storedOnly: false,
    staticMode: false,
    beatsWanted: true,
    reason: 'native-not-ready' as 'native-not-ready' | 'low-memory' | null,
    load: vi.fn<(song: { id: string }, options: { storedOnly: boolean }) => { key: string; beats: Promise<BeatFxTrackBeats> }>(),
    begin: vi.fn(),
    install: vi.fn(),
}));
vi.mock('react', () => ({
    useEffect: (setup: () => (() => void) | void) => {
        const cleanup = setup();
        if (cleanup) h.cleanups.push(cleanup);
    },
    useRef: <T>(current: T) => ({ current }),
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('../../../src/stores/usePlaybackStore', () => ({
    selectDisplaySong: ({ song }: { song: { id: string } }) => song,
    usePlaybackStore: Object.assign((selector: (state: typeof h) => unknown) => selector(h), { getState: () => h }),
}));
vi.mock('../../../src/stores/useThemeSettingsStore', () => ({
    useThemeSettingsStore: Object.assign((selector: (state: typeof h) => unknown) => selector(h), { getState: () => h }),
}));
vi.mock('../../../src/stores/usePlayerChromeSettingsStore', () => ({
    usePlayerChromeSettingsStore: Object.assign((selector: (state: object) => unknown) => selector({}), { getState: () => ({}) }),
}));
vi.mock('../../../src/stores/useVisualizerSettingsStore', () => ({
    useVisualizerSettingsStore: Object.assign(
        (selector: (state: { smartBeat: boolean }) => unknown) => selector({ smartBeat: !h.storedOnly }),
        { getState: () => ({ smartBeat: !h.storedOnly }) },
    ),
}));
vi.mock('../../../src/components/visualizer/beatClockTargets', () => ({
    liveBeatEffects: () => [], liveBeatEffectStrength: () => 1,
    visualizerWantsBeats: () => h.beatsWanted, visualizerWantsDrumHits: () => false,
    visualizerWantsEnvelopes: () => false, visualizerWantsStems: () => false,
}));
vi.mock('../../../src/services/beatFx/beatEffects', () => ({
    anyDrumBeatEffectOn: () => false, smartBeatMayAnalyse: (enabled: boolean) => enabled,
}));
vi.mock('../../../src/services/beatFx/beatFxLive', () => ({
    beginBeatFxTrack: h.begin, setBeatFxEvents: h.install, setBeatFxIntensities: vi.fn(), setBeatFxLiveEffects: vi.fn(),
}));
vi.mock('../../../src/services/beatFx/beatFxSource', () => ({ loadBeatFxTrackBeats: h.load }));
vi.mock('../../../src/services/playbackRecovery/representationRegistry', () => ({
    getPlaybackAnalysisKey: (song: { id: string }) => song.id,
}));
vi.mock('../../../src/services/analysis/modelAvailability', () => ({ modelsPresent: () => ({ htdemucs_gpu: false }), subscribeModelAvailability: vi.fn() }));
vi.mock('../../../src/services/automix/nativeModels', () => ({ isNativeModelsAvailable: () => false, subscribeModelAvailability: vi.fn() }));
vi.mock('../../../src/services/analysis/drumHits', () => ({ drumHitsSettled: vi.fn() }));
vi.mock('../../../src/services/analysis/stemRange', () => ({ setStemDrumsWanted: vi.fn() }));
vi.mock('../../../src/services/aiMemoryGate', () => ({
    localInferenceBlockedReason: () => h.reason,
    isLocalInferenceAllowed: () => h.reason === null,
    subscribeAiMemoryGate: (listener: () => void) => {
        h.listeners.add(listener);
        return () => { h.listeners.delete(listener); };
    },
}));

const { useBeatFxTrack } = await import('../../../src/hooks/useBeatFxTrack');

const empty: BeatFxTrackBeats = { events: [], source: 'none', trackScale: 1 };
const found: BeatFxTrackBeats = { events: [{ t: 1, kind: 'beat' }], source: 'beat_this', trackScale: 1 };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const notify = (reason: typeof h.reason) => {
    h.reason = reason;
    h.listeners.forEach(listener => { listener(); });
};

beforeEach(() => {
    h.song = { id: 'first' };
    h.storedOnly = false;
    h.staticMode = false;
    h.beatsWanted = true;
    h.reason = 'native-not-ready';
    h.begin.mockClear();
    h.install.mockClear();
    h.load.mockReset().mockImplementation((song) => ({ key: song.id, beats: Promise.resolve(empty) }));
});

afterEach(() => {
    h.cleanups.splice(0).forEach(cleanup => { cleanup(); });
    h.listeners.clear();
});

describe('first track beat recovery after Android startup', () => {
    it('uses only the cache before confirmation, then retries the still-visible track once', async () => {
        h.load.mockImplementation((song, { storedOnly }) => ({ key: song.id, beats: Promise.resolve(storedOnly ? empty : found) }));
        useBeatFxTrack();
        await flush();
        notify('native-not-ready');
        expect(h.load.mock.calls).toEqual([[h.song, { storedOnly: true }]]);
        notify(null);
        await flush();
        notify('low-memory');
        notify(null);
        expect(h.load.mock.calls).toEqual([[h.song, { storedOnly: true }], [h.song, { storedOnly: false }]]);
        expect(h.begin).toHaveBeenCalledTimes(1);
        expect(h.install).toHaveBeenLastCalledWith('first', found.events, 'beat_this', undefined, 1);
        expect(h.listeners.size).toBe(0);
    });

    it('recovers if confirmation arrives during the cache lookup', async () => {
        let resolve!: (result: BeatFxTrackBeats) => void;
        const beats = new Promise<BeatFxTrackBeats>(done => { resolve = done; });
        h.load.mockReturnValueOnce({ key: 'first', beats });
        useBeatFxTrack();
        notify(null);
        expect(h.load).toHaveBeenCalledTimes(1);
        resolve(empty);
        await flush();
        expect(h.load).toHaveBeenLastCalledWith(h.song, { storedOnly: false });
        expect(h.load).toHaveBeenCalledTimes(2);
        notify(null);
        expect(h.load).toHaveBeenCalledTimes(2);
    });

    it('shows partial cache beats immediately and completes them after confirmation', async () => {
        const partial = { ...found, partial: true };
        const full = { ...found, events: [...found.events, { t: 2, kind: 'beat' } as const] };
        h.load.mockReturnValueOnce({ key: 'first', beats: Promise.resolve(partial) })
            .mockReturnValueOnce({ key: 'first', beats: Promise.resolve(full) });
        useBeatFxTrack();
        await flush();
        expect(h.install).toHaveBeenLastCalledWith('first', partial.events, 'beat_this', undefined, 1);
        expect(h.load).toHaveBeenCalledTimes(1);
        notify(null);
        await flush();
        expect(h.load).toHaveBeenLastCalledWith(h.song, { storedOnly: false });
        expect(h.install).toHaveBeenLastCalledWith('first', full.events, 'beat_this', undefined, 1);
        expect(h.listeners.size).toBe(0);
    });

    it.each(['reopened before settlement', 'reopened after settlement'] as const)('keeps recovery for a pre-analysis gate reversal (%s)', async (kind) => {
        let resolve!: (result: BeatFxTrackBeats) => void;
        const interrupted = new Promise<BeatFxTrackBeats>(done => { resolve = done; });
        h.load.mockReturnValueOnce({ key: 'first', beats: Promise.resolve(empty) })
            .mockReturnValueOnce({ key: 'first', beats: interrupted })
            .mockReturnValueOnce({ key: 'first', beats: Promise.resolve(found) });
        useBeatFxTrack();
        await flush();
        notify(null);
        notify('low-memory');
        const skipped = { ...empty, nativeGateDeferred: true };
        if (kind === 'reopened before settlement') notify(null);
        resolve(skipped);
        await flush();
        if (kind === 'reopened after settlement') {
            expect(h.load).toHaveBeenCalledTimes(2);
            notify(null);
        }
        await flush();
        expect(h.load).toHaveBeenCalledTimes(3);
        expect(h.install).toHaveBeenLastCalledWith('first', found.events, 'beat_this', undefined, 1);
        expect(h.listeners.size).toBe(0);
    });

    it.each(['no beats', 'failure', 'timeout'] as const)('does not rerun actual analysis after %s and a gate cycle', async (note) => {
        h.load.mockReturnValueOnce({ key: 'first', beats: Promise.resolve(empty) })
            .mockReturnValueOnce({ key: 'first', beats: Promise.resolve({ ...empty, note }) });
        useBeatFxTrack();
        await flush();
        notify(null);
        notify('low-memory');
        await flush();
        notify(null);
        await flush();
        expect(h.load).toHaveBeenCalledTimes(2);
        expect(h.listeners.size).toBe(0);
    });

    it('does not restart a failed analysis joined by the initial cache-only lookup', async () => {
        h.load.mockReturnValueOnce({ key: 'first', beats: Promise.resolve({ ...empty, settled: true }) });
        useBeatFxTrack();
        await flush();
        notify(null);
        await flush();
        expect(h.load).toHaveBeenCalledTimes(1);
        expect(h.listeners.size).toBe(0);
    });

    it('keeps showing the partial cache when its completion is deferred', async () => {
        const partial = { ...found, partial: true };
        const deferred = { ...empty, nativeGateDeferred: true };
        h.load.mockReturnValueOnce({ key: 'first', beats: Promise.resolve(partial) })
            .mockReturnValueOnce({ key: 'first', beats: Promise.resolve({ ...partial, completion: Promise.resolve(deferred) }) })
            .mockReturnValueOnce({ key: 'first', beats: Promise.resolve({ ...partial, completion: Promise.resolve(found) }) });
        useBeatFxTrack();
        await flush();
        notify(null);
        notify('low-memory');
        await flush();
        expect(h.install).toHaveBeenLastCalledWith('first', found.events, found.source, undefined, 1);
        notify(null);
        await flush();
        expect(h.load).toHaveBeenCalledTimes(3);
        expect(h.install).not.toHaveBeenCalledWith('first', [], 'none', undefined, 1);
        expect(h.listeners.size).toBe(0);
    });

    it.each(['cache hit', 'stored-only mode', 'already ready'] as const)('does not reload after %s', async (kind) => {
        if (kind === 'cache hit') h.load.mockReturnValueOnce({ key: 'first', beats: Promise.resolve(found) });
        if (kind === 'stored-only mode') h.storedOnly = true;
        if (kind === 'already ready') h.reason = null;
        useBeatFxTrack();
        await flush();
        notify(null);
        await flush();
        expect(h.load).toHaveBeenCalledTimes(1);
        expect(h.listeners.size).toBe(0);
    });

    it.each(['song changes', 'mode changes', 'static mode', 'effect disabled', 'unmounts'] as const)('does not recover after %s while waiting', async (kind) => {
        useBeatFxTrack();
        await flush();
        if (kind === 'song changes') h.song = { id: 'second' };
        if (kind === 'mode changes') h.storedOnly = true;
        if (kind === 'static mode') h.staticMode = true;
        if (kind === 'effect disabled') h.beatsWanted = false;
        if (kind === 'unmounts') h.cleanups.splice(0).forEach(cleanup => { cleanup(); });
        notify(null);
        await flush();
        expect(h.load).toHaveBeenCalledTimes(1);
        expect(h.listeners.size).toBe(0);
    });
});
