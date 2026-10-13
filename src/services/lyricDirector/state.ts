// src/services/lyricDirector/state.ts
// The director's own persistence: behaviour settings, one decision per song, the
// settings snapshot taken before it first touched anything, and the last few
// modes it handed out.
//
// A single localStorage key keeps it away from the app's settings stores — the
// per-song memory is a cache, not a setting: it must never ride into an export,
// a sync payload or an appearance code, and it is dropped (oldest first) long
// before the storage quota is anywhere near.
//
// Subscribers get a version number, not the state: `useSyncExternalStore` needs
// a value that is stable between writes, and every reader here is a plain
// function call anyway.

const STORAGE_KEY = 'folia_lyric_director_v1';
const MEMORY_ENTRY_LIMIT = 300;
const RECENT_LIMIT = 8;

export interface LyricDirectorSettings {
    /** Decide for every track once its lyrics are ready. */
    autoOnSongChange: boolean;
    /** Reuse a song's stored pick instead of asking the AI again. */
    rememberPerSong: boolean;
    /** Off means only the mode is switched; your own parameter values stay. */
    applyParams: boolean;
    /** Decide the next queued track ahead of time, into its memory only. */
    prefetchNext: boolean;
    /** Optional preference handed to the AI ("calmer", "more transitions"). */
    userHint: string;
}

export interface LyricDirectorDecision {
    mode: string;
    reason: string;
    params: Record<string, unknown>;
    at: number;
}

export interface LyricDirectorSnapshot {
    mode: string;
    tunings: Record<string, Record<string, unknown>>;
    at: number;
}

interface PersistedState {
    settings: LyricDirectorSettings;
    decisions: Record<string, LyricDirectorDecision>;
    /** Song keys, newest first: the order entries are evicted in. */
    index: string[];
    snapshot: LyricDirectorSnapshot | null;
    recentModes: string[];
}

export const DEFAULT_DIRECTOR_SETTINGS: LyricDirectorSettings = {
    autoOnSongChange: true,
    rememberPerSong: true,
    // The user asked for both switches in Settings → AI to be on by default:
    // the mode follows the song, and the parameters go with it.
    applyParams: true,
    prefetchNext: true,
    userHint: '',
};

const emptyState = (): PersistedState => ({
    settings: { ...DEFAULT_DIRECTOR_SETTINGS },
    decisions: {},
    index: [],
    snapshot: null,
    recentModes: [],
});

const storage = (): Storage | null => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
};

let state: PersistedState = emptyState();
let loaded = false;
let version = 0;
const listeners = new Set<() => void>();

const notify = () => {
    version += 1;
    listeners.forEach((listener) => {
        try {
            listener();
        } catch {
            /* a broken listener must not stop the others */
        }
    });
};

const coerceDecision = (value: unknown): LyricDirectorDecision | null => {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (typeof raw.mode !== 'string') return null;
    return {
        mode: raw.mode,
        reason: typeof raw.reason === 'string' ? raw.reason : '',
        params: raw.params && typeof raw.params === 'object' ? raw.params as Record<string, unknown> : {},
        at: typeof raw.at === 'number' ? raw.at : 0,
    };
};

const load = (): PersistedState => {
    if (loaded) return state;
    loaded = true;
    const store = storage();
    if (!store) return state;
    try {
        const raw = store.getItem(STORAGE_KEY);
        if (!raw) return state;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const settings = { ...DEFAULT_DIRECTOR_SETTINGS };
        const savedSettings = parsed?.settings;
        if (savedSettings && typeof savedSettings === 'object') {
            const candidate = savedSettings as Record<string, unknown>;
            if (typeof candidate.autoOnSongChange === 'boolean') settings.autoOnSongChange = candidate.autoOnSongChange;
            if (typeof candidate.rememberPerSong === 'boolean') settings.rememberPerSong = candidate.rememberPerSong;
            if (typeof candidate.applyParams === 'boolean') settings.applyParams = candidate.applyParams;
            if (typeof candidate.prefetchNext === 'boolean') settings.prefetchNext = candidate.prefetchNext;
            if (typeof candidate.userHint === 'string') settings.userHint = candidate.userHint;
        }
        const decisions: Record<string, LyricDirectorDecision> = {};
        const savedDecisions = parsed?.decisions;
        if (savedDecisions && typeof savedDecisions === 'object') {
            Object.entries(savedDecisions as Record<string, unknown>).forEach(([key, value]) => {
                const decision = coerceDecision(value);
                if (decision) decisions[key] = decision;
            });
        }
        state = {
            settings,
            decisions,
            index: Array.isArray(parsed?.index) ? (parsed.index as unknown[]).filter((key): key is string => typeof key === 'string') : [],
            snapshot: parsed?.snapshot && typeof parsed.snapshot === 'object'
                ? parsed.snapshot as LyricDirectorSnapshot
                : null,
            recentModes: Array.isArray(parsed?.recentModes)
                ? (parsed.recentModes as unknown[]).filter((mode): mode is string => typeof mode === 'string').slice(0, RECENT_LIMIT)
                : [],
        };
    } catch {
        state = emptyState();
    }
    return state;
};

const persist = () => {
    const store = storage();
    if (!store) return false;
    try {
        store.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
    } catch {
        return false;
    }
};

/** Writes, dropping the oldest third of the memory if the quota said no. */
const persistWithEviction = () => {
    // Nowhere to write (no localStorage): the in-memory copy still works, and
    // evicting entries would only throw away decisions for nothing.
    if (!storage()) return;
    if (persist()) return;
    const dropCount = Math.max(1, Math.floor(state.index.length / 3));
    const dropped = state.index.slice(state.index.length - dropCount);
    dropped.forEach((key) => {
        delete state.decisions[key];
    });
    state.index = state.index.slice(0, state.index.length - dropCount);
    persist();
};

// ---- settings ----

export const readDirectorSettings = (): LyricDirectorSettings => ({ ...load().settings });

export const updateDirectorSettings = (patch: Partial<LyricDirectorSettings>): LyricDirectorSettings => {
    load();
    state.settings = { ...state.settings, ...patch };
    persistWithEviction();
    notify();
    return { ...state.settings };
};

// ---- per-song memory ----

export const readDecision = (songKey: string | null): LyricDirectorDecision | null => {
    if (!songKey) return null;
    return load().decisions[songKey] ?? null;
};

/** Newest first, deduplicated, capped; entries past the cap are dropped here. */
const touchIndex = (songKey: string) => {
    const next = [songKey, ...state.index.filter((key) => key !== songKey)];
    const dropped = next.slice(MEMORY_ENTRY_LIMIT);
    state.index = next.slice(0, MEMORY_ENTRY_LIMIT);
    dropped.forEach((key) => {
        delete state.decisions[key];
    });
};

export const writeDecision = (songKey: string, decision: Omit<LyricDirectorDecision, 'at'>): void => {
    if (!songKey) return;
    load();
    state.decisions[songKey] = { ...decision, at: Date.now() };
    touchIndex(songKey);
    persistWithEviction();
    notify();
};

export const forgetDecision = (songKey: string): void => {
    if (!songKey) return;
    load();
    delete state.decisions[songKey];
    state.index = state.index.filter((key) => key !== songKey);
    persistWithEviction();
    notify();
};

export const clearAllDecisions = (): void => {
    load();
    state.decisions = {};
    state.index = [];
    persistWithEviction();
    notify();
};

export const countDecisions = (): number => load().index.length;

// ---- settings snapshot ----

export const readSnapshot = (): LyricDirectorSnapshot | null => load().snapshot;

/** Written only when absent, so the state from before the director ever ran survives. */
export const writeSnapshotOnce = (snapshot: LyricDirectorSnapshot): void => {
    load();
    if (state.snapshot) return;
    state.snapshot = snapshot;
    persistWithEviction();
    notify();
};

export const clearSnapshot = (): void => {
    load();
    state.snapshot = null;
    persistWithEviction();
    notify();
};

// ---- recently used modes ----

export const readRecentModes = (): string[] => [...load().recentModes];

export const noteRecentMode = (mode: string): void => {
    if (!mode) return;
    load();
    state.recentModes = [mode, ...state.recentModes.filter((entry) => entry !== mode)].slice(0, RECENT_LIMIT);
    persistWithEviction();
    notify();
};

// ---- subscription ----

export const subscribeDirectorState = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const getDirectorStateVersion = (): number => {
    load();
    return version;
};

/** Test/utility hook: drops the in-memory copy so the next read reloads. */
export const resetDirectorStateForTest = (): void => {
    state = emptyState();
    loaded = false;
    notify();
};
