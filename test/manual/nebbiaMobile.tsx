import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import '../../src/i18n/config';
import '../../src/index.css';
import { NebbiaRuntime } from '../../src/components/visualizer/nebbia/createNebbiaRuntime';
import { DEFAULT_NEBBIA_TUNING, type NebbiaTuning } from '../../src/components/visualizer/nebbia/types';
import { loadNebbiaStrokes, getNebbiaStrokeMedians } from '../../src/components/visualizer/nebbia/nebbiaStrokes';
import NebbiaSettingsPanel from '../../src/components/visualizer/nebbia/NebbiaSettingsPanel';
import { settingsTokens } from '../../src/components/modal/settings/kit/kitTheme';
import { Button } from '../../src/components/ui';
import type { Line } from '../../src/types';
import { useVisualizerSettingsStore } from '../../src/stores/useVisualizerSettingsStore';
import { NEBBIA_PROBE_CASES, NEBBIA_PROBE_SEED, NEBBIA_PROBE_TIME, NEBBIA_PROBE_THEME } from './nebbiaFixtures';

// Mounts the unmodified production runtime and panel; diagnostics only inspect runtime data.
const query = new URLSearchParams(location.search);
const scenario = (query.get('case') ?? 'complex') as keyof typeof NEBBIA_PROBE_CASES;
const words = NEBBIA_PROBE_CASES[scenario] ?? NEBBIA_PROBE_CASES.complex;
const text = words.join('');
const lyric: Line = {
    fullText: text, startTime: 0, endTime: 8, wordSegments: words,
    words: [...text].map((char, i) => ({ text: char, startTime: i * 8 / text.length, endTime: (i + 1) * 8 / text.length })),
};
const fixedTime = Number(query.get('time') ?? NEBBIA_PROBE_TIME);
const initialTuning: NebbiaTuning = {
    ...DEFAULT_NEBBIA_TUNING,
    strokeWidth: Number(query.get('stroke') ?? DEFAULT_NEBBIA_TUNING.strokeWidth),
    glyphSource: query.get('glyph') === 'font' ? 'font' as const : 'strokes' as const,
    // Static scene avoids wall-clock scenery motion; layout, glyph deformation and mask are production code.
    credits: false, doodle: 0, busSpeed: 0, bump: 0, rainHit: 0, rainBig: 0,
    ...(query.get('clean') === '1' ? { behind: 'backdrop' as const, scenery: [], rain: 'off' as const, dew: 0 } : {}),
};
const delayFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const inspect = (runtime: NebbiaRuntime, tuning: NebbiaTuning) => {
    const laid = (runtime as any).laid as any[];
    const chars = laid.flatMap(line => line.chars).filter(c => c.glyph);
    return {
        scenario, text, words, seed: NEBBIA_PROBE_SEED, time: fixedTime,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        tuning, fontFamily: NEBBIA_PROBE_THEME.fontFamily,
        strokeSource: chars.some(c => getNebbiaStrokeMedians(c.ch)) ? 'supplied-AnimCJK' : 'production-font-skeleton',
        strokeCoverage: chars.filter(c => getNebbiaStrokeMedians(c.ch)).length,
        chars: chars.map(c => ({ ch: c.ch, x: c.x, y: c.y, s: c.s, rot: c.rot, strokes: c.glyph.strokes.length, wt: c.wt, wd: c.wd })),
        canvas: { width: runtime['canvas'].width, height: runtime['canvas'].height },
        minCharSize: Math.min(...chars.map(c => c.s)), maxCharSize: Math.max(...chars.map(c => c.s)),
    };
};
function Probe() {
    const { t } = useTranslation();
    const host = useRef<HTMLDivElement>(null);
    const runtime = useRef<NebbiaRuntime | null>(null);
    const [tuning, setTuning] = useState(initialTuning);
    const [panel, setPanel] = useState(query.get('panel') === '1');
    useEffect(() => {
        let dead = false;
        void (async () => {
            await loadNebbiaStrokes();
            await document.fonts.ready;
            if (dead || !host.current) return;
            const clock = motionValue(fixedTime);
            const instance = new NebbiaRuntime({
                host: host.current, seeThrough: initialTuning.behind === 'backdrop', scene: 'night', glass: initialTuning.glass,
                currentTime: clock, vocal: motionValue(0),
                onFirstFrame: () => { (window as any).__nebbiaFirstFrame = true; },
                onFailed: () => { (window as any).__nebbiaFailure = 'WebGL runtime failed'; }, onRestored: () => {},
            }, NEBBIA_PROBE_THEME, initialTuning, 1);
            runtime.current = instance;
            instance.setFontScale(Number(query.get('font') ?? 1));
            instance.setPlayback(true, true);
            // A following blank lyric sets the normal 8s write deadline (a final line has next=Infinity).
            instance.setSong({ lines: [lyric, { fullText: '', words: [], startTime: 8, endTime: 8 }], seed: NEBBIA_PROBE_SEED });
            (window as any).__nebbiaProbe = {
                setStroke: async (value: number) => {
                    setTuning(previous => ({ ...previous, strokeWidth: value }));
                    await delayFrame(); await delayFrame();
                },
                togglePanel: () => setPanel(previous => !previous),
                inspect: () => inspect(instance, (window as any).__nebbiaTuning ?? initialTuning),
                redraw: () => instance.requestFrame(),
            };
            (window as any).__nebbiaReady = true;
        })().catch(error => { (window as any).__nebbiaFailure = String(error?.stack ?? error); });
        return () => { dead = true; runtime.current?.destroy(); };
    }, []);
    useEffect(() => {
        (window as any).__nebbiaTuning = tuning;
        runtime.current?.setTuning(tuning);
    }, [tuning]);
    return <>
        <div id="nebbia-stage" ref={host} className="fixed inset-0" style={{ background: '#182332' }} />
        {query.get('controls') === '1' && <div className="fixed right-2 top-2 z-50"><Button onClick={() => setPanel(!panel)}>設定 / Settings</Button></div>}
        {panel && <aside id="nebbia-settings" className="fixed inset-0 z-40 overflow-y-auto p-4" style={{ ...settingsTokens(false, NEBBIA_PROBE_THEME), background: '#1a1a1d', color: '#eeeeee', '--text-primary': '#eeeeee' } as React.CSSProperties}>
            <NebbiaSettingsPanel settings={useVisualizerSettingsStore.getState()} t={t} theme={NEBBIA_PROBE_THEME} isDaylight={false} controlCardBg="" rangeInputClass="" tuning={tuning} onTuningChange={patch => setTuning(previous => ({ ...previous, ...patch }))} />
        </aside>}
    </>;
}
createRoot(document.getElementById('root')!).render(<Probe />);
