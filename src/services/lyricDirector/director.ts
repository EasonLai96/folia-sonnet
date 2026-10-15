import i18n from '../../i18n/config';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { selectDisplayLyrics, selectDisplaySong, usePlaybackStore } from '../../stores/usePlaybackStore';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { omni } from '../onlineMusic/omni';
import { requestStage } from '../aiStage';
import { describeAiTarget, translateAiCompletionError } from '../aiCompletion';
import type { AiCompletionTarget } from '../aiCompletion';
import {
    formatParamValue,
    gateSatisfied,
    gatesFor,
    isBlockedDirectorMode,
    isInertValue,
    isKnownDirectorMode,
    modeLabel,
    sanitizeParams,
    tuningStateKey,
    MODE_PARAMS,
} from './catalog';
import type {
    DirectorLyricLine,
    DirectorSongInfo,
} from './prompt';
import {
    noteRecentMode,
    readDirectorSettings,
    readSnapshot,
    writeSnapshotOnce,
} from './state';
import type { SongResult, VisualizerMode } from '../../types';

// src/services/lyricDirector/director.ts
// The feature itself: ask the AI which lyric animation a song should use, then
// write the answer through the player's own settings so it behaves exactly like
// a manual edit — same clamping, same storage keys, and it rides into exports.
//
// It used to be a Folium mod, which only the desktop build can load (the Android
// build has no mod system at all), so the whole thing moved in here: the writes
// go straight to the visualizer store instead of through `folium.internals`, and
// the AI call goes through services/aiCompletion, the same connection the mods
// now share.
//
// Every await is followed by an "is this still the song we asked about" check:
// a decision can be in flight for seconds, and the user may well have moved on
// by then.

const LYRICS_WAIT_FALLBACK_MS = 4000;
const LYRICS_SETTLE_MS = 250;

type VisualizerState = ReturnType<typeof useVisualizerSettingsStore.getState>;

type SongKeySource = {
    sourceRef?: { kind?: string; providerId?: string; mediaId?: string | number } | null;
    isStage?: boolean;
    localRef?: { songId?: string | number } | null;
    navidromeData?: { isNavidrome?: boolean; id?: string | number } | null;
    isNavidrome?: boolean;
    id?: string | number;
    providerId?: string;
    name?: string;
    artists?: { name?: string }[] | null;
};

export type DirectorOutcome =
    | { kind: 'applied'; text: string }
    | { kind: 'failed'; text: string }
    | { kind: 'queued' }
    | { kind: 'stale' }
    | { kind: 'no-song' };

export interface DirectorRuntime {
    busy: boolean;
    lastSummary: string;
    lastReason: string;
    currentMode: string;
    currentModeLabel: string;
    aiKnown: boolean;
    aiTarget: AiCompletionTarget | null;
}

// ------------------------------------------------------------------ song identity

/* Mirrors the host's own getPlaybackSourceRef + getPlaybackSongKey: an explicit
 * `sourceRef` wins, otherwise the song is classified the same way the host does.
 * The classification matters — a queue entry usually has no `sourceRef` yet while
 * the same song carries one once it plays, so guessing "online" for a Navidrome
 * track would file a prefetched decision under a key the playing song never
 * looks up. */
const songKeyOf = (song: unknown): string | null => {
    const raw = song as SongKeySource | null;
    if (!raw || typeof raw !== 'object') return null;
    const ref = raw.sourceRef;
    if (ref && ref.kind) {
        return ref.kind === 'online'
            ? `online:${ref.providerId ?? 'netease'}:${ref.mediaId ?? raw.id}`
            : `${ref.kind}:${ref.mediaId ?? raw.id}`;
    }
    if (raw.isStage === true) return `stage:${raw.id}`;
    if (raw.localRef?.songId) return `local:${raw.localRef.songId}`;
    const navidromeCarrier = raw.navidromeData && raw.navidromeData.isNavidrome === true
        ? raw.navidromeData
        : (raw.isNavidrome === true && raw.navidromeData ? raw : null);
    if (navidromeCarrier) {
        const navidromeId = navidromeCarrier.id ?? raw.id;
        if (navidromeId !== undefined && navidromeId !== null) return `navidrome:${navidromeId}`;
    }
    if (raw.id !== undefined && raw.id !== null) return `online:${raw.providerId ?? 'netease'}:${raw.id}`;
    const title = String(raw.name ?? '').trim().toLowerCase();
    if (!title) return null;
    const artist = Array.isArray(raw.artists)
        ? raw.artists.map((entry) => entry?.name).filter(Boolean).join('/').toLowerCase()
        : '';
    return `title:${title}|${artist}`;
};

const songInfoOf = (song: unknown): DirectorSongInfo | null => {
    const raw = song as SongKeySource | null;
    if (!raw) return null;
    return {
        title: raw.name ?? '',
        artist: Array.isArray(raw.artists) ? raw.artists.map((artist) => artist?.name).filter(Boolean).join(' / ') : '',
        album: null,
    };
};

const lyricLinesOf = (lyrics: unknown): DirectorLyricLine[] => {
    const lines = (lyrics as { lines?: unknown } | null)?.lines;
    if (!Array.isArray(lines)) return [];
    return lines.map((line) => {
        const raw = line as { fullText?: unknown; translation?: unknown; songPart?: unknown; isChorus?: unknown };
        return {
            fullText: typeof raw?.fullText === 'string' ? raw.fullText : '',
            translation: typeof raw?.translation === 'string' ? raw.translation : '',
            songPart: typeof raw?.songPart === 'string' ? raw.songPart : '',
            isChorus: Boolean(raw?.isChorus),
        };
    });
};

const displaySong = () => selectDisplaySong(usePlaybackStore.getState());
const displayLyrics = () => selectDisplayLyrics(usePlaybackStore.getState());
const currentSongKey = () => songKeyOf(displaySong());
const currentLines = () => lyricLinesOf(displayLyrics());

// ------------------------------------------------------------------ runtime

let busy = false;
let inFlightSongKey: string | null = null;
let pendingSongKey: string | null = null;
let pendingForce = false;
let prefetchedSongKey: string | null = null;
let awaitingLyricsSongKey: string | null = null;
let lyricsTimer: ReturnType<typeof setTimeout> | null = null;
let lastReason = '';
let lastSummary = '';
let aiTarget: AiCompletionTarget | null = null;
let aiKnown = false;
const inFlight = new Set<AbortController>();
const listeners = new Set<() => void>();

const translate = (key: string) => i18n.t(key) as string;

let runtimeSnapshot: DirectorRuntime = buildRuntime();

function buildRuntime(): DirectorRuntime {
    const state = useVisualizerSettingsStore.getState();
    const mode = typeof state?.visualizerMode === 'string' ? state.visualizerMode : 'classic';
    return {
        busy,
        lastSummary,
        lastReason,
        currentMode: mode,
        currentModeLabel: modeLabel(mode, translate),
        aiKnown,
        aiTarget,
    };
}

const refreshRuntime = () => {
    runtimeSnapshot = buildRuntime();
    listeners.forEach((listener) => {
        try {
            listener();
        } catch {
            /* a broken listener must not stop the others */
        }
    });
};

export const subscribeDirectorRuntime = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const getDirectorRuntime = (): DirectorRuntime => runtimeSnapshot;

/** Reads what Settings → AI is set to. Never throws: a missing key is a state to show. */
export const refreshDirectorAiStatus = (): void => {
    try {
        aiTarget = describeAiTarget();
    } catch {
        aiTarget = null;
    }
    aiKnown = true;
    refreshRuntime();
};

// ------------------------------------------------------------------ applying

const currentModeOf = (state: VisualizerState): string => (
    typeof state?.visualizerMode === 'string' ? state.visualizerMode : 'classic'
);

/* An id the registry does not know is a hallucination; a mode the user blocked is
 * one the AI was never shown, so an answer naming it is treated the same way —
 * both degrade to the mode that is already playing. */
const validatedMode = (mode: unknown, fallback: string, blockedModes: readonly string[] = []): string => {
    const candidate = typeof mode === 'string' ? mode.trim() : '';
    if (isKnownDirectorMode(candidate) && !isBlockedDirectorMode(candidate, blockedModes)) return candidate;
    return fallback;
};

interface ApplyResult {
    mode: string;
    applied: string[];
}

const applyDecision = (
    decision: { mode?: unknown; params?: unknown },
    options: { applyParams: boolean; blockedModes: readonly string[] },
): ApplyResult => {
    const state = useVisualizerSettingsStore.getState();
    const previousMode = currentModeOf(state);
    const mode = validatedMode(decision?.mode, previousMode, options.blockedModes);
    const label = modeLabel(mode, translate);
    const applied: string[] = [];

    if (mode !== previousMode) {
        // notify:false keeps the store from stacking its own toast on top of ours.
        state.handleSetVisualizerMode(mode, { notify: false });
        applied.push(translate('aiDirector.lineMode').replace('{{label}}', label));
    } else {
        // Report the pick even when it agrees with the player: a summary with no
        // mode line reads as "it never chose a mode".
        applied.push(translate('aiDirector.lineModeUnchanged').replace('{{label}}', label));
    }
    if (!options.applyParams) return { mode, applied };

    const spec = MODE_PARAMS[mode];
    const raw = state as unknown as Record<string, unknown>;
    if (!spec || !spec.setter || typeof raw[spec.setter] !== 'function') return { mode, applied };

    const patch = sanitizeParams(mode, decision?.params);
    if (Object.keys(patch).length === 0) return { mode, applied };

    const tuningKey = tuningStateKey(spec.setter);
    const currentTuning = (tuningKey ? raw[tuningKey] : null) as Record<string, unknown> | null;

    /* A value behind a closed switch changes nothing on screen, so open the gate
     * in the same write — but only when opening it actually unblocks the value,
     * and never for a switch the AI spoke about itself. */
    const requested = Object.keys(patch);
    const openedFor = new Set<string>();
    requested.forEach((key) => {
        if (isInertValue(spec.params[key], patch[key])) return;
        const gates = gatesFor(mode, key);
        if (gates.length === 0) return;
        const preview = { ...(currentTuning ?? {}), ...patch };
        if (gates.every((gate) => gateSatisfied(preview, gate))) return;
        const injectable = gates.filter((gate) => !gateSatisfied(preview, gate));
        if (injectable.some((gate) => gate.key in patch)) return; // the AI decided this switch
        const trial = { ...preview };
        injectable.forEach((gate) => {
            trial[gate.key] = gate.setTo ?? gate.mustBe;
        });
        if (!gates.every((gate) => gateSatisfied(trial, gate))) return; // opening it would not help
        injectable.forEach((gate) => {
            patch[gate.key] = gate.setTo ?? gate.mustBe;
        });
        openedFor.add(key);
    });
    (raw[spec.setter] as (next: Record<string, unknown>) => void)(patch);

    /* Read the values back from a FRESH state: the setters call the store's own
     * `set`, which replaces the state object, so the snapshot above holds the old
     * tuning. Cappella rewrites a custom emoji pack to builtin when none is
     * uploaded, and partita sorts the stagger pair — reporting the request would
     * claim a value the store does not hold. */
    const afterState = useVisualizerSettingsStore.getState() as unknown as Record<string, unknown>;
    const storedTuning = tuningKey && afterState?.[tuningKey] && typeof afterState[tuningKey] === 'object'
        ? afterState[tuningKey] as Record<string, unknown>
        : null;
    const actualValueOf = (key: string): unknown => (
        storedTuning && key in storedTuning ? storedTuning[key] : patch[key]
    );
    const finalTuning = { ...(currentTuning ?? {}), ...patch, ...(storedTuning ?? {}) };

    requested.forEach((key) => {
        const zh = spec.params[key]?.zh ?? key;
        const inert = isInertValue(spec.params[key], patch[key]);
        const blocked = !inert && gatesFor(mode, key).some((gate) => !gateSatisfied(finalTuning, gate));
        const actual = actualValueOf(key);
        const rewritten = storedTuning !== null && key in storedTuning && storedTuning[key] !== patch[key];
        let suffix = '';
        if (blocked) suffix = translate('aiDirector.suffixBlocked');
        else if (openedFor.has(key)) suffix = translate('aiDirector.suffixGateOpened');
        if (rewritten) suffix += translate('aiDirector.suffixAdjusted');
        applied.push(`${zh}→${formatParamValue(actual)}${suffix}`);
    });
    return { mode, applied };
};

// ------------------------------------------------------------------ snapshot

const snapshotSettings = (): void => {
    const state = useVisualizerSettingsStore.getState() as unknown as Record<string, unknown>;
    if (!state) return;
    if (readSnapshot()) return;
    const tunings: Record<string, Record<string, unknown>> = {};
    Object.entries(MODE_PARAMS).forEach(([mode, spec]) => {
        const key = tuningStateKey(spec.setter);
        if (key && state[key] && typeof state[key] === 'object') {
            tunings[mode] = state[key] as Record<string, unknown>;
        }
    });
    writeSnapshotOnce({
        mode: currentModeOf(useVisualizerSettingsStore.getState()),
        tunings,
        at: Date.now(),
    });
};

/** Puts the mode and every tuning back to what they were before the first decision. */
export const restoreLyricDirectorSnapshot = (): string => {
    const snapshot = readSnapshot();
    if (!snapshot) return translate('aiDirector.restoreNone');
    const typed = useVisualizerSettingsStore.getState();
    const state = typed as unknown as Record<string, unknown>;
    if (typeof snapshot.mode === 'string') {
        typed.handleSetVisualizerMode(snapshot.mode as VisualizerMode, { notify: false });
    }
    Object.entries(snapshot.tunings ?? {}).forEach(([mode, tuning]) => {
        const setter = MODE_PARAMS[mode]?.setter;
        if (setter && typeof state[setter] === 'function' && tuning && typeof tuning === 'object') {
            (state[setter] as (next: Record<string, unknown>) => void)(tuning);
        }
    });
    return translate('aiDirector.restoreDone');
};

// ------------------------------------------------------------------ the request

/*
 * 动画决策走统一 stage 入口（services/aiStage.ts）。
 *
 * 切歌后主题那条链路通常已经先问过同一段歌词了 —— policy 由同一个函数算出来，指纹相同，
 * 这里直接命中它留下的结果，不再发第二次请求。以前这两件事是各自单独问一次模型的。
 *
 * 「按歌记住」现在由云缓存承担：命中缓存 = 沿用这首歌上次的答案，跨设备也一样。
 */
const requestDecision = async (input: {
    song: DirectorSongInfo | null;
    lines: DirectorLyricLine[];
    targetSongKey: string | null;
    force: boolean;
}): Promise<{ mode: string; reason: string; params: Record<string, unknown> }> => {
    const settings = readDirectorSettings();
    /*
     * 请求自己不带中止，登记到 inFlight 里，好让 abortLyricDirectorRequests()
     * 在切歌时把它掐掉 —— 否则一首歌切走之后，上一次的判断还在路上，回来时
     * 会把结果画到已经换了的那首歌上。
     */
    const controller = new AbortController();
    inFlight.add(controller);
    try {
        const { decision } = await requestStage({
            song: input.song,
            lines: input.lines,
            /* 没歌词就是纯音乐，和主题那条链路同一个判定 —— 指纹要对得上。 */
            isPureMusic: input.lines.length === 0,
            songTitle: input.song?.title ?? '',
            hint: settings.userHint,
            blockedModes: settings.blockedModes,
            currentMode: currentModeOf(useVisualizerSettingsStore.getState()),
            /* 关掉「按歌记住」= 每次都重新问一次模型，不复用云缓存里那份旧答案。 */
            force: input.force || !settings.rememberPerSong,
            signal: controller.signal,
            require: 'decision',
        });
        if (!decision) throw new Error('AI 没有返回可用的动画决策。');
        return decision;
    } finally {
        inFlight.delete(controller);
    }
};

const toast = (text: string, type: 'info' | 'success' | 'error') => {
    setStatusMessage({ type, text, nonce: Date.now() });
};

export const runLyricDirectorDecision = async (options: { announce?: boolean; force?: boolean } = {}): Promise<DirectorOutcome> => {
    const announce = options.announce !== false;
    const force = options.force === true;
    const settings = readDirectorSettings();
    const songKey = currentSongKey();
    if (!songKey || !songInfoOf(displaySong())) return { kind: 'no-song' };

    const liveKey = currentSongKey();
    if (!liveKey || !songInfoOf(displaySong())) return { kind: 'no-song' };

    if (busy) {
        pendingSongKey = liveKey;
        pendingForce = pendingForce || force;
        return { kind: 'queued' };
    }

    busy = true;
    inFlightSongKey = liveKey;
    refreshRuntime();
    try {
        const decision = await requestDecision({
            song: songInfoOf(displaySong()),
            lines: currentLines(),
            targetSongKey: liveKey,
            force,
        });

        /* The track changed while the AI was thinking: this answer describes a
         * song that is no longer playing, so it is dropped rather than painted
         * onto the new one. It stays in the cloud cache under *that* song's
         * fingerprint, so the next play comes back for free. */
        const nowKey = currentSongKey();
        if (nowKey !== inFlightSongKey) {
            return { kind: 'stale' };
        }

        snapshotSettings();
        const result = applyDecision(decision, {
            applyParams: settings.applyParams,
            blockedModes: settings.blockedModes,
        });
        lastReason = typeof decision?.reason === 'string' ? decision.reason : '';
        lastSummary = result.applied.length > 0
            ? result.applied.join('，')
            : translate('aiDirector.nothingToChange');
        noteRecentMode(result.mode);
        const text = `${lastSummary}${lastReason ? `（${lastReason}）` : ''}`;
        refreshRuntime();
        if (announce) toast(translate('aiDirector.toastApplied').replace('{{text}}', text), 'success');
        return { kind: 'applied', text };
    } catch (error) {
        const message = translateAiCompletionError(String((error as Error)?.message ?? error));
        lastSummary = `${translate('aiDirector.failed')}${message}`;
        lastReason = '';
        refreshRuntime();
        if (announce) toast(translate('aiDirector.toastFailed').replace('{{text}}', message), 'error');
        return { kind: 'failed', text: message };
    } finally {
        busy = false;
        inFlightSongKey = null;
        refreshRuntime();
        if (pendingSongKey !== null) {
            const queued = pendingSongKey;
            const queuedForce = pendingForce;
            pendingSongKey = null;
            pendingForce = false;
            if (queued === currentSongKey()) {
                void runLyricDirectorDecision({ announce: true, force: queuedForce });
            }
        } else {
            void prefetchNextSong();
        }
    }
};

// ------------------------------------------------------------------ prefetch

/* The complaint this solves: the first seconds of a track played under the
 * previous song's animation, because a decision only started once the song was
 * already on screen. The next queued track is prepared ahead of time and stored
 * in its memory; when it starts, the decision above finds the entry at once.
 * Only the *memory* is written here — a queued song is not on screen yet. */
const nextQueuedSong = (): unknown => {
    const state = usePlaybackStore.getState();
    const queue = Array.isArray(state?.playQueue) ? state.playQueue : null;
    const current = state?.currentSong ?? null;
    if (!queue || queue.length === 0 || !current) return null;
    const currentKey = songKeyOf(current);
    const index = queue.findIndex((song) => songKeyOf(song) === currentKey);
    const lastIndex = queue.length - 1;
    if (index >= 0 && index < lastIndex) return queue[index + 1] ?? null;
    if (index < 0) return queue[0] ?? null;
    const loopMode = useAudioSettingsStore.getState()?.loopMode;
    return loopMode === 'all' ? (queue[0] ?? null) : null;
};

const prefetchNextSong = async (): Promise<void> => {
    const settings = readDirectorSettings();
    if (!settings.autoOnSongChange || !settings.prefetchNext) return;
    if (busy) return; // never race the song that is on screen
    const song = nextQueuedSong();
    if (!song) return;
    const key = songKeyOf(song);
    if (!key || key === prefetchedSongKey) return;
    if (key === songKeyOf(displaySong())) return;
    if (!settings.rememberPerSong) return; // 关掉「按歌记住」就不预先问

    prefetchedSongKey = key;
    try {
        const result = await omni.getLyrics(song as SongResult);
        const lines = lyricLinesOf((result as { lyrics?: unknown } | null)?.lyrics);
        if (lines.length === 0) {
            prefetchedSongKey = null;
            return;
        }
        if (busy || songKeyOf(displaySong()) === key) return;
        /*
         * 预先问一次：答案由 requestStage 自己推进云端缓存与进程内缓存，等这首歌真正
         * 开始播放时，导演链路按同一个指纹命中它，就不用再等一次模型了。
         * 本地不再落盘 —— 结果只有一份，存在云端。
         */
        await requestDecision({
            song: songInfoOf(song),
            lines,
            targetSongKey: key,
            force: false,
        });
    } catch {
        prefetchedSongKey = null; // a failed prefetch must not block a later retry
    }
};

// ------------------------------------------------------------------ scheduling

/* The auto decision waits for the lyrics instead of running on a fixed delay:
 * lyrics arrive after the song does, and deciding before they land would send
 * "(这首歌没有歌词)" for a song that has them. The fallback timer covers tracks
 * whose lyrics never come. */
export const scheduleLyricDirectorDecision = (): void => {
    if (!readDirectorSettings().autoOnSongChange) return;
    if (lyricsTimer !== null) {
        clearTimeout(lyricsTimer);
        lyricsTimer = null;
    }
    const key = currentSongKey();
    if (!key || !songInfoOf(displaySong())) {
        awaitingLyricsSongKey = null;
        return;
    }
    const decide = () => {
        lyricsTimer = null;
        awaitingLyricsSongKey = null;
        void runLyricDirectorDecision({ announce: true });
    };
    if (currentLines().length > 0) {
        lyricsTimer = setTimeout(decide, LYRICS_SETTLE_MS);
        return;
    }
    awaitingLyricsSongKey = key;
    lyricsTimer = setTimeout(decide, LYRICS_WAIT_FALLBACK_MS);
};

/** Called when lyrics land while a decision is waiting for them. */
export const notifyLyricDirectorLyricsLoaded = (): void => {
    if (awaitingLyricsSongKey === null) return;
    if (currentLines().length === 0) return;
    awaitingLyricsSongKey = null;
    if (lyricsTimer !== null) {
        clearTimeout(lyricsTimer);
        lyricsTimer = null;
    }
    lyricsTimer = setTimeout(() => {
        lyricsTimer = null;
        void runLyricDirectorDecision({ announce: true });
    }, LYRICS_SETTLE_MS);
};

/** A new track is on screen: whatever was prepared for the queue is stale now. */
export const notifyLyricDirectorSongChanged = (): void => {
    prefetchedSongKey = null;
    scheduleLyricDirectorDecision();
};

export const abortLyricDirectorRequests = (): void => {
    if (lyricsTimer !== null) {
        clearTimeout(lyricsTimer);
        lyricsTimer = null;
    }
    awaitingLyricsSongKey = null;
    inFlight.forEach((controller) => {
        try {
            controller.abort();
        } catch {
            /* already settled */
        }
    });
    inFlight.clear();
};

/** The song key the panel is talking about; null when nothing is on screen. */
export const currentDirectorSongKey = (): string | null => currentSongKey();

export const currentDirectorSong = (): DirectorSongInfo | null => songInfoOf(displaySong());
