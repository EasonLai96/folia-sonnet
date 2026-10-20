import { useEffect, useState, useSyncExternalStore } from 'react';
import { modelCanRun, subscribeModelAvailability } from '../services/analysis/modelAvailability';
import { probeBeatThisGpu } from '../services/analysis/beatThisGpu';

// src/hooks/useSmartBeatAvailability.ts
// Whether beat FX (智能动感模式, in every mode and background that draws them) can do anything on this
// install, for a setting to say so next to its switch. The switch itself stays usable either way - it
// is a preference - but a switch that is on and silently inert is the failure this is here to prevent.
//
// Two things have to be true, and they are now separate questions. The weights: either the copy a
// desktop install ships, or the one this app downloaded from the CDN - so "not downloaded yet" is a
// real state here, where it used to be impossible. And a GPU: an adapter this renderer can get.

/** 'noWeights' - nothing downloaded yet; 'noGpu' - downloaded, but this device cannot run it. */
export type SmartBeatAvailability = 'ready' | 'noWeights' | 'noGpu';

/**
 * Asked only while `enabled` - the switch is on. Off, nothing is probed (no adapter request) and the
 * answer is 'ready', which a caller shows nothing for.
 */
export function useSmartBeatAvailability(enabled: boolean): SmartBeatAvailability {
    // Optimistic until the probe answers: a hint flashing "no GPU" on every open would be worse.
    const [gpu, setGpu] = useState(true);
    // Subscribed, because downloading the weights has to take this hint away without a relaunch.
    const weights = useSyncExternalStore(subscribeModelAvailability, () => modelCanRun('beat_this'));

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        void probeBeatThisGpu().then((found) => {
            if (!cancelled) setGpu(found);
        });
        return () => {
            cancelled = true;
        };
    }, [enabled]);

    if (!enabled) return 'ready';
    if (!weights) return 'noWeights';
    return gpu ? 'ready' : 'noGpu';
}
